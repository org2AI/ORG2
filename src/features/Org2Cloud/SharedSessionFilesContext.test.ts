// @vitest-environment jsdom
import { getDefaultStore } from "jotai";
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION_ARTIFACT_ORIGIN_ARG } from "@src/engines/SessionCore/conversations/conversationArtifactOrigin";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  SharedSessionEventFilesProvider,
  SharedSessionFilesProvider,
  useOpenSessionSharedFile,
} from "./SharedSessionFilesContext";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  access: vi.fn(),
  notice: vi.fn(),
}));
vi.mock("@src/components/Message", () => ({ default: { info: mocks.notice } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./openSharedSessionFile", () => ({
  openSharedSessionFile: (
    reference: unknown,
    access: unknown,
    pending: unknown
  ) => {
    mocks.viewer({ reference, pending });
    mocks.access(access);
  },
}));
let open: (path: string) => boolean;
function LinkConsumer() {
  const interceptor = useOpenSessionSharedFile();
  useLayoutEffect(() => {
    open = interceptor;
  }, [interceptor]);
  return null;
}
const root = createSmokeRoot();
afterEach(async () => {
  await root.unmount();
  vi.clearAllMocks();
});

describe("per-event shared file routing", () => {
  it.each([true, false])(
    "binds the guest artifact on imported=%s without using the reader's workspace",
    async (imported) => {
      const event = {
        args: {
          [CONVERSATION_ARTIFACT_ORIGIN_ARG]: {
            uploaderUserId: "guest",
            sessionId: "original-root",
            revision: "original:time",
            repoPath: "/sender",
          },
        },
      } as unknown as SessionEvent;
      await root.render(
        createElement(
          SharedSessionFilesProvider,
          {
            scope: {
              orgId: "org",
              sessionId: "root",
              endpoint: "https://cloud.example",
              repoPath: "/reader",
              shareToken: "guest-ticket",
              eventOnly: !imported,
            },
          },
          createElement(
            SharedSessionEventFilesProvider,
            { event },
            createElement(LinkConsumer)
          )
        )
      );
      await act(async () => {
        expect(open("proof.txt")).toBe(true);
      });
      expect(mocks.access).toHaveBeenCalledWith({
        endpoint: "https://cloud.example",
        shareToken: "guest-ticket",
      });
      expect(mocks.viewer).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: {
            id: "source",
            endpoint: "https://cloud.example",
            source: {
              orgId: "org",
              sessionId: "original-root",
              path: "/sender/proof.txt",
              version: { uploaderUserId: "guest", revision: "original:time" },
            },
          },
        })
      );
    }
  );
  it("never falls through to local disk when remote scope is unavailable", async () => {
    const event = {
      args: {
        [CONVERSATION_ARTIFACT_ORIGIN_ARG]: {
          uploaderUserId: "guest",
          sessionId: "root",
          revision: "old",
        },
      },
    } as unknown as SessionEvent;
    await root.render(
      createElement(
        SharedSessionEventFilesProvider,
        { event },
        createElement(LinkConsumer)
      )
    );
    await act(async () => {
      expect(open("/sender/proof.txt")).toBe(true);
    });
    expect(mocks.viewer).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: expect.objectContaining({ endpoint: "" }),
      })
    );
  });
  it.each([
    { __orgiiMaterialized: true },
    { __orgiiSourceEventId: "orgii_evt_inherited" },
  ])(
    "intercepts unresolved inherited output before cloud hydration: %s",
    async (args) => {
      await root.render(
        createElement(
          SharedSessionEventFilesProvider,
          { event: { id: "preview", args } as unknown as SessionEvent },
          createElement(LinkConsumer)
        )
      );
      await act(async () => {
        expect(open("/reader/proof.txt")).toBe(true);
      });
      expect(mocks.notice).not.toHaveBeenCalled();
      expect(mocks.viewer).toHaveBeenCalledTimes(1);
      const { pending } = mocks.viewer.mock.calls[0][0];
      expect(getDefaultStore().get(pending.referenceAtom)).toBeNull();
      const origin = {
        uploaderUserId: "sender",
        sessionId: "original",
        revision: "v1",
        repoPath: "/sender",
      };
      await root.render(
        createElement(
          SharedSessionEventFilesProvider,
          {
            event: {
              id: "preview",
              args: { ...args, [CONVERSATION_ARTIFACT_ORIGIN_ARG]: origin },
            } as unknown as SessionEvent,
          },
          createElement(LinkConsumer)
        )
      );
      expect(getDefaultStore().get(pending.referenceAtom)).toEqual({
        id: "source",
        endpoint: "",
        source: {
          orgId: "",
          sessionId: "original",
          path: "/reader/proof.txt",
          version: { uploaderUserId: "sender", revision: "v1" },
        },
      });
      // Hydration updates the existing tab without reopening a dismissed tab or stealing focus.
      expect(mocks.viewer).toHaveBeenCalledTimes(1);
    }
  );
  it("preserves navigation for genuinely local owner output", async () => {
    await root.render(
      createElement(
        SharedSessionFilesProvider,
        {
          scope: {
            orgId: "org",
            sessionId: "root",
            endpoint: "https://cloud.example",
            eventOnly: true,
          },
        },
        createElement(
          SharedSessionEventFilesProvider,
          { event: { id: "local", args: {} } as SessionEvent },
          createElement(LinkConsumer)
        )
      )
    );
    expect(open("/local/report.md")).toBe(false);
    expect(mocks.viewer).not.toHaveBeenCalled();
  });
});
