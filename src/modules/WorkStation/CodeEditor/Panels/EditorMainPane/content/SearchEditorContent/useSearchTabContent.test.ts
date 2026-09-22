// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { clearSearchTabSessionStates } from "@src/store/workstation/codeEditor/search";

import { useSearchTabContent } from "./useSearchTabContent";

const api = vi.hoisted(() => ({
  search: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  unlisten: vi.fn(),
  logError: vi.fn(),
  listeners: new Map<
    string,
    (event: { payload: Record<string, unknown> }) => void
  >(),
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: api.logError }),
}));
vi.mock("@src/api/tauri/search", () => ({
  searchCodeFast: api.search,
  searchCodeStreaming: api.search,
  searchCodeRegex: vi.fn(async () => []),
  cancelSearch: api.cancel,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      name: string,
      callback: (event: { payload: Record<string, unknown> }) => void
    ) => {
      api.listeners.set(name, callback);
      return () => {
        api.unlisten();
        if (api.listeners.get(name) === callback) api.listeners.delete(name);
      };
    }
  ),
}));
const Probe = forwardRef<ReturnType<typeof useSearchTabContent>>(
  (_props, ref) => {
    const state = useSearchTabContent({
      sessionScopeId: "manual-search",
      repoPath: "/repo",
      searchMode: "regex",
      initialQuery: "seed",
    });
    useImperativeHandle(ref, () => state, [state]);
    return null;
  }
);
Probe.displayName = "ManualSearchProbe";
afterEach(() => {
  vi.useRealTimers();
  clearSearchTabSessionStates();
  vi.clearAllMocks();
  api.listeners.clear();
});

it("does no backend work while typing; submits explicitly and keeps draft state separate across remounts", async () => {
  vi.useFakeTimers();
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  let root = createRoot(container);
  const ref = createRef<ReturnType<typeof useSearchTabContent>>();
  try {
    await act(async () => root.render(createElement(Probe, { ref })));
    expect(ref.current!.awaitingSubmission).toBe(true);
    for (let i = 0; i < 50; i++) {
      act(() => ref.current!.setQuery(`draft ${i}`));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    expect(api.search).not.toHaveBeenCalled();
    await act(async () => {
      ref.current!.refresh();
    });
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(api.search.mock.calls[0]).toContain("draft 49");
    expect(ref.current!.submittedSearch?.query).toBe("draft 49");
    const oldComplete = api.listeners.get("search-complete")!;
    const oldId = (api.search.mock.calls[0] as unknown[])[0];
    act(() => ref.current!.setQuery("new draft"));
    expect(ref.current!.awaitingSubmission).toBe(true);
    expect(ref.current!.submittedSearch?.query).toBe("draft 49");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      ref.current!.refresh();
    });
    expect(api.search).toHaveBeenCalledTimes(2);
    act(() =>
      oldComplete({
        payload: {
          search_id: oldId,
          total_matches: 999,
          total_files: 999,
          has_more: false,
        },
      })
    );
    expect(ref.current!.actualTotalMatches).toBe(0);
    expect(ref.current!.loading).toBe(true);
    act(() => ref.current!.setOptions({ caseSensitive: true }));
    expect(ref.current!.awaitingSubmission).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.search).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(Probe, { ref })));
    expect(ref.current!.query).toBe("new draft");
    expect(ref.current!.awaitingSubmission).toBe(true);
    expect(ref.current!.loading).toBe(false);
    expect(api.search).toHaveBeenCalledTimes(2);
    act(() => ref.current!.setQuery(""));
    await act(async () => {
      ref.current!.refresh();
    });
    expect(ref.current!.submittedSearch).toBeNull();
    expect(ref.current!.results).toEqual([]);
    expect(api.search).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

it("handles rejected submission setup without an unhandled promise", async () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  const ref = createRef<ReturnType<typeof useSearchTabContent>>();
  try {
    await act(async () => root.render(createElement(Probe, { ref })));
    await act(async () => ref.current!.refresh());
    const error = new Error("Listener cleanup failed");
    api.unlisten.mockImplementationOnce(() => {
      throw error;
    });
    await act(async () => ref.current!.refresh());
    expect(api.logError).toHaveBeenCalledWith(
      "Failed to execute submitted search",
      error
    );
    expect(api.search).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
