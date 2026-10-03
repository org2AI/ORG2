// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import FindCard from "@src/scaffold/GlobalSpotlight/FindCard";
import {
  chatFindInChatOpenAtomFamily,
  chatSearchSyncAtomFamily,
} from "@src/store/ui/chatPanel/miscAtoms";

import { agentOrgExecutionNavigationAtom } from "../../agentOrgExecutionNavigation";
import { useTranscriptViewport } from "../../viewport/useTranscriptViewport";
import {
  type UseChatSearchOptions,
  type UseChatSearchReturn,
  useChatSearch,
} from "../useChatSearch";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  highlight: vi.fn(),
  clear: vi.fn(),
  navigate: vi.fn(),
  expandTurn: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@src/engines/SessionCore", () => ({
  useEventNavigation: () => ({ navigateToEvent: mocks.navigate }),
}));
vi.mock("@src/engines/ChatPanel/ChatCollapseScope", async () => {
  const { atom } = await import("jotai");
  const collapse = atom(null, () => undefined);
  const expandTurn = atom(null, (_get, _set, value) => mocks.expandTurn(value));
  return {
    useChatCollapseState: () => ({
      setTurnCollapseOverrideAtom: expandTurn,
      setCollapseStateAtom: collapse,
    }),
  };
});
vi.mock("../chatSearch/chatSearchHighlightDom", () => ({
  applySearchTextHighlight: mocks.highlight,
  clearSearchTextHighlights: mocks.clear,
}));

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousActEnvironment: boolean | undefined;
let store: ReturnType<typeof createStore>;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let search: UseChatSearchReturn;
let options: UseChatSearchOptions;
let renderCard = false;
function Harness() {
  const value = useChatSearch(options);
  useLayoutEffect(() => {
    search = value;
  }, [value]);
  return renderCard
    ? createElement(FindCard, { search: value, scope: "session" })
    : null;
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function query(value: string) {
  act(() => search.setQuery(value));
}
const syncedQuery = () =>
  store.get(chatSearchSyncAtomFamily("session-1")).query;

beforeEach(() => {
  previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  renderCard = false;
  mocks.invoke.mockResolvedValue([]);
  store = createStore();
  store.set(chatFindInChatOpenAtomFamily("session-1"), true);
  host = document.createElement("div");
  document.body.append(host);
  options = {
    sessionId: "session-1",
    chatHistory: [
      {
        id: "event-1",
        chunk_id: "event-1",
        sessionId: "session-1",
        displayText: "unrelated content",
        args: {},
        result: {},
      } as SessionEvent,
    ],
    flatItems: [],
    groupCounts: [],
    groupMeta: [],
    pages: [],
    turnPaginationEnabled: false,
    currentPageIndex: 0,
    setTurnPageSelection: vi.fn(),
    virtualListRef: { current: null },
    chatContainerRef: { current: host },
    onExplicitNavigation: vi.fn(),
  };
  root = createRoot(host);
  act(() =>
    root.render(createElement(Provider, { store }, createElement(Harness)))
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("chat search highlight scheduling", () => {
  it("lets empty-input mode buttons toggle visibly before the first search", async () => {
    renderCard = true;
    act(() =>
      root.render(createElement(Provider, { store }, createElement(Harness)))
    );
    expect(host.querySelector('[data-icon="search-list-01"]')).not.toBeNull();
    expect(host.querySelector('[data-icon="search"]')).toBeNull();
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")
    );
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("false");
      act(() => button.click());
    }
    await advance(1000);
    expect(search.query).toBe("");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.highlight).not.toHaveBeenCalled();
    query("alpha");
    await advance(500);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "es_search_chat_events",
      expect.objectContaining({
        options: expect.objectContaining({
          query: "alpha",
          caseSensitive: true,
          wholeWord: true,
          useRegex: true,
        }),
      })
    );
  });
  it("keeps typing immediate but commits one search/highlight per settled burst", async () => {
    query("z");
    await advance(200);
    query("ze");
    await advance(200);
    query("zen");
    expect(search.query).toBe("zen");
    await advance(499);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(syncedQuery()).toBe("");
    expect(mocks.highlight).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(syncedQuery()).toBe("zen");
    await advance(50);
    expect(mocks.highlight).toHaveBeenCalledOnce();
    const clears = mocks.clear.mock.calls.length;
    query("zeni");
    await advance(100);
    query("zenit");
    expect(syncedQuery()).toBe("zen");
    expect(mocks.clear).toHaveBeenCalledTimes(clears);
    expect(mocks.highlight).toHaveBeenCalledOnce();
    await advance(500);
    await advance(50);
    expect(syncedQuery()).toBe("zenit");
    expect(mocks.highlight).toHaveBeenCalledTimes(2);
  });
  it("rejects an older response during the next typing debounce window", async () => {
    let resolve!: (results: never[]) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    query("old");
    await advance(500);
    query("new");
    await act(async () => {
      resolve([]);
    });
    expect(syncedQuery()).toBe("");
    expect(mocks.highlight).not.toHaveBeenCalled();
    await advance(500);
    expect(syncedQuery()).toBe("new");
  });
  it("clears immediately and cancels the queued query", async () => {
    query("zen");
    await advance(500);
    query("next");
    query("");
    expect(syncedQuery()).toBe("");
    await advance(1000);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(search.isSearching).toBe(false);
  });
  it("cancels queued search when closed through the shortcut atom", async () => {
    query("zen");
    act(() => store.set(chatFindInChatOpenAtomFamily("session-1"), false));
    await advance(1000);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(syncedQuery()).toBe("");
  });
  it("Enter/navigation flushes the draft without a later duplicate search", async () => {
    query("zen");
    await act(async () => search.nextResult());
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(syncedQuery()).toBe("zen");
    await advance(1000);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
  it("rejects an in-flight response after closing", async () => {
    let resolve!: (results: never[]) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    query("old");
    await advance(500);
    act(() => store.set(chatFindInChatOpenAtomFamily("session-1"), false));
    await act(async () => {
      resolve([]);
    });
    await advance(50);
    expect(syncedQuery()).toBe("");
    expect(mocks.highlight).not.toHaveBeenCalled();
    expect(search.isSearching).toBe(false);
  });
  it("cancels queued work when switching sessions", async () => {
    query("old");
    options = { ...options, sessionId: "session-2" };
    store.set(chatFindInChatOpenAtomFamily("session-2"), true);
    act(() =>
      root.render(createElement(Provider, { store }, createElement(Harness)))
    );
    await advance(1000);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(store.get(chatSearchSyncAtomFamily("session-2")).query).toBe("");
    expect(search.query).toBe("");
  });
  it("applies a mode change once without leaving a duplicate draft timer", async () => {
    query("zen");
    await act(async () => search.toggleCaseSensitive());
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "es_search_chat_events",
      expect.objectContaining({
        options: expect.objectContaining({ query: "zen", caseSensitive: true }),
      })
    );
    await advance(1000);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
  it("cancels queued work on unmount", async () => {
    query("zen");
    act(() => root.render(null));
    await advance(1000);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

it("selects the exact execution page before scrolling to its formal group", async () => {
  const scrollToGroup = vi.fn();
  const event = {
    ...options.chatHistory[0],
    args: {
      agentOrgExecution: {
        turnIntentId: "old",
        participantId: "reviewer",
        participantName: "Reviewer",
        sourceKind: "member_messages" as const,
      },
    },
  };
  options = {
    ...options,
    virtualListRef: {
      current: {
        scrollToGroup,
        scrollToChatTarget: vi.fn(),
        revealTranscriptAnchor: vi.fn(),
      },
    },
    chatHistory: [event],
    turnPaginationEnabled: true,
    currentPageIndex: 1,
    flatItems: [{ chunk_id: event.id, type: "activity", event }],
    groupCounts: [1, 0],
    groupMeta: [
      {
        turnId: "agent-org-execution-old",
        execution: event.args.agentOrgExecution,
        durationMs: 0,
        itemCount: 1,
        bodyEventCount: 1,
        hasBody: true,
        previewText: "",
        startMs: null,
        endMs: null,
        unloadedTurn: null,
      },
      {
        turnId: "new",
        durationMs: 0,
        itemCount: 0,
        bodyEventCount: 0,
        hasBody: false,
        previewText: "",
        startMs: null,
        endMs: null,
        unloadedTurn: null,
      },
    ],
    pages: [
      {
        startGroupIndex: 0,
        endGroupIndex: 0,
        flatStartIndex: 0,
        flatEndIndex: 1,
        cursorIdeSummary: null,
      },
      {
        startGroupIndex: 1,
        endGroupIndex: 1,
        flatStartIndex: 1,
        flatEndIndex: 1,
        cursorIdeSummary: null,
      },
    ],
  };
  act(() => {
    store.set(agentOrgExecutionNavigationAtom, {
      sessionId: "session-1",
      turnIntentId: "old",
    });
    root.render(createElement(Provider, { store }, createElement(Harness)));
  });
  expect(options.setTurnPageSelection).toHaveBeenCalledWith({
    sessionId: "session-1",
    pageIndex: 0,
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
  options = { ...options, currentPageIndex: 0 };
  act(() =>
    root.render(createElement(Provider, { store }, createElement(Harness)))
  );
  await advance(32);
  expect(scrollToGroup).toHaveBeenCalledWith({
    groupIndex: 0,
    behavior: "auto",
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(store.get(agentOrgExecutionNavigationAtom)).toBeNull();
});

it.each([false, true])(
  "locates an execution without a rendered input event (pagination: %s)",
  async (paginated) => {
    const scrollToGroup = vi.fn();
    const execution = {
      turnIntentId: "report",
      participantId: "coordinator",
      participantName: "Coordinator",
      sourceKind: "final_summary" as const,
    };
    const meta = {
      durationMs: 0,
      itemCount: 0,
      bodyEventCount: 0,
      hasBody: false,
      previewText: "",
      startMs: null,
      endMs: null,
      unloadedTurn: null,
    };
    options = {
      ...options,
      // The persisted execution anchor belongs to the header, never flatItems.
      chatHistory: [
        { ...options.chatHistory[0], args: { agentOrgExecution: execution } },
      ],
      flatItems: [],
      groupCounts: [0, 0],
      groupMeta: [
        { ...meta, turnId: "older" },
        { ...meta, turnId: "agent-org-execution-report", execution },
      ],
      pages: [0, 1].map((index) => ({
        startGroupIndex: index,
        endGroupIndex: index,
        flatStartIndex: 0,
        flatEndIndex: 0,
        cursorIdeSummary: null,
      })),
      turnPaginationEnabled: paginated,
      currentPageIndex: 1,
      virtualListRef: {
        current: {
          scrollToGroup,
          scrollToChatTarget: vi.fn(),
          revealTranscriptAnchor: vi.fn(),
        },
      },
    };
    act(() => {
      store.set(agentOrgExecutionNavigationAtom, {
        sessionId: "session-1",
        turnIntentId: "report",
      });
      root.render(createElement(Provider, { store }, createElement(Harness)));
    });
    // Expanding the turn publishes a fresh projection before the frame runs.
    options = { ...options, groupMeta: [...options.groupMeta] };
    act(() =>
      root.render(createElement(Provider, { store }, createElement(Harness)))
    );
    expect(mocks.expandTurn).toHaveBeenCalledTimes(1);
    await advance(32);
    expect(scrollToGroup).toHaveBeenCalledWith({
      groupIndex: paginated ? 0 : 1,
      behavior: "auto",
    });
    expect(
      options.virtualListRef.current?.scrollToChatTarget
    ).not.toHaveBeenCalled();
    expect(store.get(agentOrgExecutionNavigationAtom)).toBeNull();
  }
);

it("keeps a distant execution visible when expansion resizes before the scroll event", async () => {
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 2200 },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  scroller.scrollTo = (value) => {
    scroller.scrollTop = typeof value === "object" ? (value.top ?? 0) : 0;
  };
  for (const [id, top] of [
    ["older", 0],
    ["report", 1600],
  ] as const) {
    const anchor = document.createElement("div");
    anchor.dataset.transcriptAnchorId = id;
    anchor.getBoundingClientRect = () =>
      ({
        top: top - scroller.scrollTop,
        bottom: top + 500 - scroller.scrollTop,
      }) as DOMRect;
    scroller.append(anchor);
  }
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  const execution = {
    turnIntentId: "report",
    participantId: "coordinator",
    participantName: "Coordinator",
    sourceKind: "final_summary" as const,
  };
  options = {
    ...options,
    groupMeta: [
      {
        turnId: "agent-org-execution-report",
        execution,
        durationMs: 0,
        itemCount: 1,
        bodyEventCount: 1,
        hasBody: true,
        previewText: "",
        startMs: null,
        endMs: null,
        unloadedTurn: null,
      },
    ],
    groupCounts: [1],
    virtualListRef: {
      current: {
        revealTranscriptAnchor: () => true,
        scrollToChatTarget: vi.fn(),
        scrollToGroup: () => {
          scroller.scrollTo({ top: 1600 });
          // WebKit observes the expanded content before delivering its scroll event.
          resize();
        },
      },
    },
  };
  function ViewportHarness() {
    const viewport = useTranscriptViewport({
      sessionKey: options.sessionId,
      contentKey: "expanded-report",
      itemCount: 2,
    });
    const { setScrollRoot } = viewport;
    useLayoutEffect(() => {
      setScrollRoot(scroller);
    }, [setScrollRoot]);
    useChatSearch({
      ...options,
      onExplicitNavigation: viewport.detachForNavigation,
    });
    return null;
  }
  try {
    act(() =>
      root.render(
        createElement(Provider, { store }, createElement(ViewportHarness))
      )
    );
    await advance(32);
    scroller.scrollTop = 0;
    act(() =>
      store.set(agentOrgExecutionNavigationAtom, {
        sessionId: "session-1",
        turnIntentId: "report",
      })
    );
    await advance(32);
    expect(scroller.scrollTop).toBe(1600);
    act(resize);
    expect(scroller.scrollTop).toBe(1600);
    expect(store.get(agentOrgExecutionNavigationAtom)).toBeNull();
  } finally {
    act(() => root.render(null));
    vi.unstubAllGlobals();
  }
});
