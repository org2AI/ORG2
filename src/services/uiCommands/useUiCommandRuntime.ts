import { Channel } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { z } from "zod";

import { useBrowserContext } from "@src/contexts/workstation";
import { createLogger } from "@src/hooks/logger";
import { uiCommands } from "@src/scaffold/ActionSystem/publicUi/catalog";
import { defineZodAction } from "@src/scaffold/ActionSystem/schema/defineZodAction";
import { zodActionRegistry } from "@src/scaffold/ActionSystem/schema/zodRegistry";
import { createBrowserSessionTab } from "@src/store/workstation/browser/tabs";
import {
  openWorkstationTabAtom,
  presentedWorkstationWorkspaceKeyAtom,
} from "@src/store/workstation/tabs";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { getCurrentWindowLabel } from "@src/util/platform/tauri/windowIdentity";
import { comparableBrowserUrl } from "@src/util/url/browserUrl";

import catalog from "../../../src-tauri/crates/app-ui/catalog.json";
import { createUiDependencies } from "./dependencies";
import { executeUiRequest } from "./execute";
import { failure, requestSchema } from "./protocol";
import type { UiRequest, UiResponse } from "./protocol";

const log = createLogger("UiCommandRuntime");
const envelopeSchema = z.strictObject({
  generation: z.string(),
  request: requestSchema,
});

/** One document-owned channel, bounded by the broker; no session or DOM polling. */
export function useUiCommandRuntime(): void {
  const browser = useBrowserContext();
  const browserRef = useRef(browser);
  // Only bridges the gap between a React state write and its committed snapshot.
  // BrowserContext remains the resource owner; this is cleared on commit/dispose.
  const pendingBrowserTabs = useRef(new Map<string, WorkStationTab>());
  useEffect(() => {
    browserRef.current = browser;
  }, [browser]);
  useEffect(() => {
    pendingBrowserTabs.current.clear();
  }, [browser.sessions]);
  useEffect(() => {
    if (getCurrentWindowLabel() !== "main") return;
    let disposed = false;
    let generation: string | undefined;
    let queue = Promise.resolve();
    let queued = 0;
    const pendingTabs = pendingBrowserTabs.current;
    const actions = uiCommands.map((command) =>
      defineZodAction(
        {
          id: command.id,
          category: "app",
          description: command.description,
          // Transport, not an affordance. "gui" would put all 14 into
          // getADEExposedActions() and therefore into the GUI control manifest
          // the model reads through control_orgii — with a {generation,
          // request} schema no model can satisfy, since the generation is
          // broker-issued and deps.active() rejects a fabricated one.
          layer: "action",
          params: envelopeSchema,
        },
        async ({ request, generation: requestGeneration }) => {
          const deps = createUiDependencies(
            requestGeneration,
            request,
            (url, workspace) => {
              const store = getInstrumentedStore();
              // Existing BrowserContext has global active-resource synchronization. Limit new
              // resources to the presented workspace until that owner supports scoped creation.
              if (
                JSON.stringify(
                  store.get(presentedWorkstationWorkspaceKeyAtom)
                ) !== JSON.stringify(workspace)
              )
                throw new Error(
                  "TARGET_NOT_PRESENTABLE: Browser creation currently requires the presented workspace"
                );
              const current = browserRef.current;
              const key = comparableBrowserUrl(url);
              const pending = pendingTabs.get(key);
              if (pending) {
                current.handleSessionClick(pending.data.sessionId as string);
                store.set(openWorkstationTabAtom, { workspace, tab: pending });
                return { tab: pending, created: false };
              }
              const existing = current.sessions.find(
                (session) =>
                  !session.incognito &&
                  comparableBrowserUrl(session.url) ===
                    comparableBrowserUrl(url)
              );
              if (!existing && pendingTabs.size >= 50)
                throw new Error(
                  "BUSY: Browser resource creation awaits a React commit"
                );
              const id = existing?.id ?? current.handleAddSession(url);
              if (existing) current.handleSessionClick(existing.id);
              const tab = createBrowserSessionTab(
                id,
                existing?.title ?? new URL(url).hostname,
                { url, sessionId: id }
              );
              store.set(openWorkstationTabAtom, { workspace, tab });
              if (!existing) pendingTabs.set(key, tab);
              return { tab, created: !existing };
            }
          );
          const active = deps.active;
          deps.active = async () => !disposed && (await active()) && !disposed;
          if (disposed)
            return { success: false, message: "UI runtime disconnected" };
          const response = await executeUiRequest(request, deps);
          return { success: true, data: response };
        }
      )
    );
    zodActionRegistry.registerAll(actions);
    const channel = new Channel<{ generation: string; request: UiRequest }>();
    channel.onmessage = (message) => {
      if (queued >= 50) {
        invokeTauri("ui_command_result", {
          generation: message.generation,
          response: failure(
            message.request,
            "BUSY",
            "Frontend command queue is full"
          ),
        }).catch(() => undefined);
        return;
      }
      queued++;
      queue = queue
        .then(async () => {
          if (disposed) return;
          const parsed = envelopeSchema.safeParse(message);
          if (!parsed.success) {
            // Returning silently would leave the broker entry pending until
            // the caller's timeoutMs and report a *deterministic* rejection as
            // an uncertain outcome — the one result the rulebook tells agents
            // never to auto-retry. The broker only dispatches fully typed
            // requests, so the echo below always has a target to match on;
            // if it somehow does not, resolve would reject it anyway.
            if (message.request?.target)
              await invokeTauri("ui_command_result", {
                generation: message.generation,
                response: failure(
                  message.request,
                  "INVALID_PARAMS",
                  parsed.error.message
                ),
              });
            return;
          }
          const result = await zodActionRegistry.execute(
            message.request.command,
            parsed.data
          );
          const response = (result.data ??
            failure(
              message.request,
              "EXECUTION_FAILED",
              result.message ?? "UI dispatch failed"
            )) as UiResponse;
          await invokeTauri("ui_command_result", {
            generation: message.generation,
            response,
          });
        })
        .catch((error: unknown) => {
          log.warn("UI command transport failed", error);
        })
        .finally(() => {
          queued--;
        });
    };
    invokeTauri<string>("ui_runtime_register", {
      channel,
      catalogHash: catalog.hash,
    })
      .then((value) => {
        generation = value;
        if (disposed)
          return invokeTauri("ui_runtime_unregister", { generation: value });
      })
      .catch((error: unknown) => {
        log.warn("UI command registration failed", error);
      });
    return () => {
      disposed = true;
      pendingTabs.clear();
      zodActionRegistry.unregisterAll(actions.map((action) => action.meta.id));
      if (generation)
        invokeTauri("ui_runtime_unregister", { generation }).catch(
          () => undefined
        );
    };
  }, []);
}
