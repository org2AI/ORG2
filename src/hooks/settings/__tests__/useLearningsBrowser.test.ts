// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  type UseLearningsBrowserReturn,
  useLearningsBrowser,
} from "../useLearningsBrowser";

const api = vi.hoisted(() => ({
  browseList: vi.fn(),
  getStatus: vi.fn(),
  setStatus: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@src/api/tauri/rpc", () => ({ rpc: { learning: api } }));
let root: Root;
let latest: UseLearningsBrowserReturn;
function Probe({ scopes }: { scopes?: string[] }) {
  const value = useLearningsBrowser({ agentScopes: scopes });
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  api.browseList.mockResolvedValue([]);
  api.setStatus.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("loads and refreshes lists without requesting the retired status report", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(latest.loading).toBe(false);
  expect(api.browseList).toHaveBeenCalledTimes(1);
  await act(async () =>
    latest.setFilters({ status: "pending", search: "note" })
  );
  expect(api.browseList).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "pending", search: "note" })
  );
  await act(async () => latest.setStatus("entry", "active"));
  expect(api.setStatus).toHaveBeenCalledWith({
    learningId: "entry",
    next: "active",
  });
  await act(async () => latest.remove("entry"));
  expect(api.remove).toHaveBeenCalledWith({ learningId: "entry" });
  expect(api.browseList).toHaveBeenCalledTimes(4);
  expect(api.getStatus).not.toHaveBeenCalled();
});

it("retains per-agent loading, deduplication and newest-first ordering", async () => {
  const old = { id: "old", updated_at: "2026-01-01" };
  const recent = { id: "new", updated_at: "2026-02-01" };
  api.browseList.mockImplementation(({ agentScope }) =>
    Promise.resolve(agentScope === "a" ? [old] : [old, recent])
  );
  await act(async () =>
    root.render(createElement(Probe, { scopes: ["a", "b"] }))
  );
  expect(api.browseList.mock.calls.map(([args]) => args.agentScope)).toEqual([
    "a",
    "b",
  ]);
  expect(latest.items.map(({ id }) => id)).toEqual(["new", "old"]);
  expect(api.getStatus).not.toHaveBeenCalled();
});

it("keeps list errors visible and supports retry", async () => {
  api.browseList.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(createElement(Probe)));
  expect(latest.error).toBe("offline");
  expect(latest.loading).toBe(false);
  await act(async () => latest.refresh());
  expect(latest.error).toBeNull();
});
