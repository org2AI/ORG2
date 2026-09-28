// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  sessionIdAtom,
  streamingDeltaContentAtom,
} from "@src/engines/SessionCore/core/atoms";
import { _setCliToolAliasMap } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import type { AliasEntry } from "@src/engines/SessionCore/rendering/registry/types";
import { buildCliStreamingEvent } from "@src/engines/SessionCore/sync/adapters/cli/streamingEvent";

import { processChatItems } from "../chatItemPipeline";
import { renderActivity } from "./ExtendedItemRenderers";

it("renders a production CLI live row from its direct stream buffer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Use the Rust-exported aliases: the older global test setup maps assistant
  // to a tool fallback, unlike the real app's agent_message renderer.
  const registry = JSON.parse(
    readFileSync("src/test/fixtures/tool-registry.rust.json", "utf8")
  );
  _setCliToolAliasMap(
    new Map(
      Object.entries(registry.cli_aliases).map(([name, value]) => {
        const [storage, ui, simulatorApp, appSubtool, chatBlock] =
          value as string[];
        return [
          name,
          { storage, ui, simulatorApp, appSubtool, chatBlock } as AliasEntry,
        ];
      })
    )
  );
  const store = createStore();
  store.set(sessionIdAtom, "cliagent-live");
  store.set(
    streamingDeltaContentAtom,
    new Map([
      ["cliagent-live", { kind: "message", content: "Growing live message" }],
    ])
  );
  const event = buildCliStreamingEvent(
    "stream-msg-ts-live",
    "cliagent-live",
    "Gro",
    "message",
    new Date().toISOString()
  );
  const { items } = processChatItems([event]);
  expect(items).toHaveLength(1);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          renderActivity(items[0], 0, event.id)
        )
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Growing live message")
    );
    // The event object stays structurally frozen while its per-session buffer grows.
    await act(async () =>
      store.set(
        streamingDeltaContentAtom,
        new Map([
          [
            "cliagent-live",
            { kind: "message", content: "Growing live message, second chunk" },
          ],
          [
            "unrelated",
            { kind: "message", content: "Must not leak into this row" },
          ],
        ])
      )
    );
    expect(container.textContent).toContain(
      "Growing live message, second chunk"
    );
    expect(container.textContent).not.toContain("Must not leak");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
