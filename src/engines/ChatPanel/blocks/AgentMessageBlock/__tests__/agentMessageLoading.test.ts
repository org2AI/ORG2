// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTurnContext } from "@src/engines/ChatPanel/ChatHistory/AgentTurnContext";

import AgentMessageBlock from "../index";
import { readTruncatedResponseTurn } from "../useAgentMessageExpansion";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loaded: vi.fn(),
  prune: vi.fn(),
}));
vi.mock("@src/engines/SessionCore/turns", () => ({
  loadSessionTurnBodyIntoStore: mocks.load,
  isTurnBodyLoaded: mocks.loaded,
  pruneLoadedTurnBodies: mocks.prune,
}));
vi.mock("@src/engines/ChatPanel/blocks/useBlockLocate", () => ({
  useBlockHeader: () => ({}),
}));
vi.mock("@src/engines/ChatPanel/blocks/primitives", () => ({
  EventNavigateIcon: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof createStore>;
let height = 100;
const turn = { sessionId: "codexapp-test", turnId: "first" };
async function render(
  unloaded: boolean,
  turnId = "first",
  eventId = "preview"
) {
  const blockProps = {
    children: "response text",
    truncatedResponseTurn: readTruncatedResponseTurn(turn.sessionId, {
      unloadedTurn: { turnId, bodyEventCount: 12, previewTruncated: unloaded },
    }),
  };
  await act(async () =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          AgentTurnContext.Provider,
          {
            value: {
              ...turn,
              turnId,
              isLastGroup: false,
              isLastItemInGroup: true,
            },
          },
          createElement(AgentMessageBlock, { key: eventId, ...blockProps })
        )
      )
    )
  );
}
function button() {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="expand-overlay-toggle"]'
  );
}
async function click() {
  await act(async () => {
    button()!.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  height = 100;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => height
  );
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(undefined);
  mocks.loaded.mockReturnValue(true);
  mocks.prune.mockResolvedValue(undefined);
  store = createStore();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agent message existing fade/expand loading", () => {
  it("uses the same overlay for actually truncated previews and preserves expansion across full-row replacement", async () => {
    let resolve!: () => void;
    mocks.load.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      })
    );
    await render(true);
    expect(button()?.getAttribute("aria-label")).toBe("actions.expand");
    expect(container.querySelector(".from-chat-pane")).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(mocks.load).not.toHaveBeenCalled();
    await click();
    await click();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledWith(turn);
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    // EventStore replaces the catalog event before the loader promise resolves.
    height = 900;
    await render(false, "first", "full-message");
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector<HTMLElement>(".group\\/expand")?.style.maxHeight
    ).toBe("none");
    await act(async () => resolve());
    expect(mocks.prune).toHaveBeenCalledWith(turn.sessionId, [turn.turnId]);
    await click();
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "empty"])(
    "keeps the existing expand control retryable after %s",
    async (failure) => {
      if (failure === "error")
        mocks.load.mockRejectedValueOnce(new Error("unavailable"));
      else mocks.loaded.mockReturnValueOnce(false);
      await render(true);
      await click();
      expect(button()?.getAttribute("aria-label")).toBe("actions.expand");
      expect(mocks.prune).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("Load full response");
      await click();
      expect(mocks.load).toHaveBeenCalledTimes(2);
      expect(mocks.prune).toHaveBeenCalledTimes(1);
    }
  );

  it("keeps already-loaded short messages unclipped and long-message expansion local", async () => {
    await render(false);
    expect(button()).toBeNull();
    height = 900;
    await render(false, "first", "long");
    await click();
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("does not apply a late failed load to a different turn", async () => {
    let reject!: (error: Error) => void;
    mocks.load.mockReturnValueOnce(
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
    );
    await render(true);
    await click();
    height = 900;
    await render(false, "other-turn", "other-event");
    await click();
    await act(async () => reject(new Error("late failure")));
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("bounds retained expansion intent and isolates it by store", async () => {
    height = 900;
    for (let i = 0; i < 129; i++) {
      await render(false, `turn-${i}`, `event-${i}`);
      await click();
    }
    await render(false, "turn-0", "oldest");
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    await render(false, "turn-128", "newest");
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    store = createStore();
    await render(false, "turn-128", "other-store");
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("offers loading again after an expanded response is evicted without fetching on mount", async () => {
    height = 900;
    await render(false);
    await click();
    await render(true, "first", "evicted-preview");
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
