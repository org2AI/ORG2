// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { DEFAULT_SEARCH_TAB_OPTIONS } from "@src/store/workstation/codeEditor/search";

import { useSearchExecution } from "../useSearchExecution";

const api = vi.hoisted(() => ({
  search: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  unlistens: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("@src/api/tauri/search", () => ({
  searchCodeFast: api.search,
  searchCodeStreaming: api.search,
  searchCodeRegex: vi.fn(async () => []),
  cancelSearch: api.cancel,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => {
    const off = vi.fn();
    api.unlistens.push(off);
    return off;
  }),
}));
vi.mock("@src/hooks/perf/useDebouncedCallback", () => ({
  useDebouncedCallback: () => Object.assign(() => {}, { cancel: () => {} }),
}));
const actions = {
  setResults: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  setHasMore: vi.fn(),
  setActualTotalMatches: vi.fn(),
  setActualTotalFiles: vi.fn(),
  appendResults: vi.fn(),
  clearAtom: vi.fn(),
};
const Probe = forwardRef<ReturnType<typeof useSearchExecution>>(
  (_props, ref) => {
    const search = useSearchExecution({
      automatic: false,
      query: "needle",
      searchMode: "regex",
      repoPath: "/repo",
      openFiles: [],
      storeOptions: DEFAULT_SEARCH_TAB_OPTIONS,
      resultActions: actions,
    });
    useImperativeHandle(ref, () => search, [search]);
    return null;
  }
);
Probe.displayName = "SearchRefreshProbe";

it("explicit refresh replaces the previous active request and its listeners", async () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const ref = createRef<ReturnType<typeof useSearchExecution>>();
  try {
    await act(async () => root.render(createElement(Probe, { ref })));
    await act(async () => {
      void ref.current!.refresh();
    });
    expect(api.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      void ref.current!.refresh();
    });
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.unlistens).toHaveLength(4);
    expect(api.unlistens[0]).toHaveBeenCalledOnce();
    expect(api.unlistens[1]).toHaveBeenCalledOnce();
    expect(api.unlistens[2]).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
  expect(api.unlistens.every((off) => off.mock.calls.length === 1)).toBe(true);
});
