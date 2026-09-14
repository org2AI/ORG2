// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSearchExecution } from "../useSearchExecution";

vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));
const api = vi.hoisted(() => ({
  searchCodeFast: vi.fn(),
  searchCodeRegex: vi.fn(),
  cancelSearch: vi.fn(async () => true),
  listeners: new Map<
    string,
    Set<(event: { payload: Record<string, unknown> }) => void>
  >(),
  listenGate: null as Promise<void> | null,
  unlisten: vi.fn(),
}));
vi.mock("@src/api/tauri/search", () => api);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      name: string,
      fn: (event: { payload: Record<string, unknown> }) => void
    ) => {
      if (api.listenGate) await api.listenGate;
      if (!api.listeners.has(name)) api.listeners.set(name, new Set());
      api.listeners.get(name)!.add(fn);
      return () => {
        api.unlisten();
        api.listeners.get(name)!.delete(fn);
      };
    }
  ),
}));
const options = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  fileExtensions: [],
  excludeDirs: [],
  filesToInclude: "",
  filesToExclude: "",
  onlyOpenFiles: false,
};
const resultActions = {
  setResults: vi.fn(),
  setLoading: vi.fn(),
  setLoadingMore: vi.fn(),
  setError: vi.fn(),
  setHasMore: vi.fn(),
  setActualTotalMatches: vi.fn(),
  setActualTotalFiles: vi.fn(),
  appendResults: vi.fn(),
  clearAtom: vi.fn(),
};
let root: Root;
let controller: ReturnType<typeof useSearchExecution>;
const pending: (() => void)[] = [];
function Probe({
  query = "needle",
  repoPath = "/fixture/A",
  storeOptions = options,
  openFiles = [],
}: {
  query?: string;
  repoPath?: string;
  storeOptions?: typeof options;
  openFiles?: string[];
}) {
  const value = useSearchExecution({
    query,
    repoPath,
    searchMode: "regex",
    openFiles,
    storeOptions,
    resultActions,
  });
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}
async function render(props = {}) {
  await act(async () => root.render(React.createElement(Probe, props)));
}
async function advance() {
  await act(async () => vi.advanceTimersByTimeAsync(200));
}
function event(name: string, payload: Record<string, unknown>) {
  for (const listener of api.listeners.get(name) ?? []) listener({ payload });
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  pending.length = 0;
  api.listenGate = null;
  api.searchCodeFast.mockImplementation(
    () => new Promise<void>((resolve) => pending.push(resolve))
  );
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  act(() => root.unmount());
  await act(async () => {
    for (const finish of pending) finish();
  });
  api.listeners.clear();
  vi.useRealTimers();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});
it("clears and cancels old output; switches repo/options and retries same request", async () => {
  await render();
  await advance();
  const oldId = api.searchCodeFast.mock.calls[0][0];
  await render({ query: "" });
  expect(api.cancelSearch).toHaveBeenCalledWith(oldId);
  act(() =>
    event("search-result", {
      search_id: oldId,
      result: { file_path: "old", matches: [] },
    })
  );
  await advance();
  expect(resultActions.appendResults).not.toHaveBeenCalled();
  await render({ repoPath: "/fixture/B" });
  await advance();
  expect(api.searchCodeFast.mock.calls[1][2]).toBe("/fixture/B");
  await render({
    repoPath: "/fixture/B",
    storeOptions: { ...options, wholeWord: true },
  });
  await advance();
  expect(api.searchCodeFast.mock.calls[2][3].whole_word).toBe(true);
  let retry!: Promise<void>;
  act(() => {
    retry = controller.search();
  });
  await act(async () => {});
  expect(api.searchCodeFast).toHaveBeenCalledTimes(4);
  await act(async () => {
    event("search-complete", {
      search_id: api.searchCodeFast.mock.calls[3][0],
      total_matches: 0,
      total_files: 0,
      has_more: false,
    });
    pending[3]();
    await retry;
  });
});
it("releases an asynchronously registered listener after unmount before starting native work", async () => {
  let resolve!: () => void;
  api.listenGate = new Promise<void>((r) => {
    resolve = r;
  });
  await render();
  await advance();
  act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => resolve());
  expect(api.unlisten).toHaveBeenCalledTimes(1);
  expect(api.searchCodeFast).not.toHaveBeenCalled();
});
it("failure releases both listeners and same-query retry succeeds without polling", async () => {
  api.searchCodeFast.mockRejectedValueOnce(new Error("invalid regex"));
  await render();
  await advance();
  expect(api.unlisten).toHaveBeenCalledTimes(2);
  expect(resultActions.setError).toHaveBeenCalledWith("invalid regex");
  let retry!: Promise<void>;
  act(() => {
    retry = controller.search(1000, true);
  });
  await act(async () => {});
  const id = api.searchCodeFast.mock.calls[1][0];
  act(() => {
    event("search-result", {
      search_id: id,
      result: { file_path: "new", matches: [] },
      actual_matches: 1,
      actual_files: 1,
    });
    event("search-complete", {
      search_id: id,
      total_matches: 1,
      total_files: 1,
      has_more: false,
    });
  });
  await act(async () => {
    pending[0]();
    await retry;
  });
  expect(resultActions.appendResults).toHaveBeenCalledWith([
    { file_path: "new", matches: [] },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});
it("open-files result cannot publish after newer request; empty open scope does not search repo", async () => {
  let finish!: (value: []) => void;
  api.searchCodeRegex.mockImplementationOnce(
    () =>
      new Promise<[]>((r) => {
        finish = r;
      })
  );
  await render({
    storeOptions: { ...options, onlyOpenFiles: true },
    openFiles: ["/fixture/A/a.ts"],
  });
  await advance();
  await render({
    query: "new",
    storeOptions: { ...options, onlyOpenFiles: true },
    openFiles: [],
  });
  await advance();
  resultActions.setResults.mockClear();
  await act(async () => finish([]));
  expect(resultActions.setResults).not.toHaveBeenCalled();
  expect(api.searchCodeRegex).toHaveBeenCalledTimes(1);
  expect(api.searchCodeFast).not.toHaveBeenCalled();
});
it("waits for delayed WebView result/complete after invoke already resolved", async () => {
  api.searchCodeFast.mockResolvedValueOnce(undefined);
  await render();
  await advance();
  expect(api.unlisten).not.toHaveBeenCalled();
  const id = api.searchCodeFast.mock.calls[0][0];
  const result = { file_path: "delayed", matches: [] };
  await act(async () => {
    event("search-result", {
      search_id: id,
      result,
      actual_matches: 1,
      actual_files: 1,
    });
    event("search-complete", {
      search_id: id,
      total_matches: 1,
      total_files: 1,
      has_more: false,
    });
  });
  expect(resultActions.appendResults).toHaveBeenCalledWith([result]);
  expect(api.unlisten).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("a missing completion event hits one deadline and cancels/releases the owner", async () => {
  api.searchCodeFast.mockResolvedValueOnce(undefined);
  await render();
  await advance();
  const id = api.searchCodeFast.mock.calls[0][0];
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(api.cancelSearch).toHaveBeenCalledWith(id);
  expect(api.unlisten).toHaveBeenCalledTimes(2);
  expect(resultActions.setError).toHaveBeenCalledWith("fileSearch.timeout");
  expect(vi.getTimerCount()).toBe(0);
});
it("clear cancels the scheduled request before its debounce starts", async () => {
  await render();
  act(() => controller.clear());
  await advance();
  expect(api.searchCodeFast).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("open-file batches keep their repository glob base and report a capped batch as incomplete", async () => {
  api.searchCodeRegex.mockResolvedValue([
    {
      file_path: "/fixture/A/src/a.rs",
      matches: [
        {
          line: 1,
          column: 1,
          end_line: 1,
          end_column: 7,
          text: "needle",
          context_before: "",
          context_after: "",
        },
      ],
    },
  ]);
  await render({
    openFiles: ["/fixture/A/src/a.rs"],
    storeOptions: {
      ...options,
      onlyOpenFiles: true,
      filesToInclude: "src/**/*.rs",
    },
  });
  await act(async () => controller.search(1));
  expect(api.searchCodeRegex).toHaveBeenCalledWith(
    "needle",
    ["/fixture/A/src/a.rs"],
    expect.objectContaining({ include_globs: ["src/**/*.rs"] }),
    expect.any(String),
    "/fixture/A"
  );
  expect(resultActions.setHasMore).toHaveBeenLastCalledWith(true);
  await act(async () => controller.search(2, true));
  expect(resultActions.setHasMore).toHaveBeenLastCalledWith(false);
});
