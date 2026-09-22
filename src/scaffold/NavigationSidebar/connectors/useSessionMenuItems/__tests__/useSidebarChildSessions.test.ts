// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Session } from "@src/store/session";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useSidebarChildSessions } from "../useSidebarChildSessions";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), upsert: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@src/store/session", () => ({ upsertSession: mocks.upsert }));
let root: ReturnType<typeof createSmokeRoot>;
let fetched: ReadonlyMap<string, Session[]>;
function Harness({
  parents,
  enabled,
}: {
  parents: Session[];
  enabled: boolean;
}) {
  const current = useSidebarChildSessions(parents, enabled);
  useLayoutEffect(() => {
    fetched = current;
  }, [current]);
  return null;
}
const parent = (id: string): Session => ({
  session_id: id,
  status: "completed",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z",
});
const child = (id: string, parentSessionId = "parent") => ({
  sessionId: id,
  name: "Agent (child)",
  status: "completed",
  createdAt: "2026-09-17T00:00:00Z",
  updatedAt: "2026-09-17T00:00:00Z",
  sessionType: "agent",
  parentSessionId,
});
const render = (ids: string[], enabled = true) =>
  root.render(createElement(Harness, { parents: ids.map(parent), enabled }));
beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue([]);
  mocks.upsert.mockReset();
  root = createSmokeRoot();
});
afterEach(async () => {
  await root.unmount();
});

it("evicts removed parent caches and issues a fresh query when an unchanged id reappears", async () => {
  mocks.invoke.mockResolvedValueOnce([child("first-child")]);
  await render(["parent"]);
  expect(fetched.get("parent")?.map((row) => row.session_id)).toEqual([
    "first-child",
  ]);
  await render([]);
  expect(fetched.size).toBe(0);
  mocks.invoke.mockResolvedValueOnce([child("replacement-child")]);
  await render(["parent"]);
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(fetched.get("parent")?.map((row) => row.session_id)).toEqual([
    "replacement-child",
  ]);
});

it("rejects late child writes after parent removal, including deletion followed by same-id reappearance", async () => {
  let finishOld!: (records: ReturnType<typeof child>[]) => void;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  await render(["parent"]);
  await render([]);
  mocks.invoke.mockResolvedValueOnce([child("fresh-child")]);
  await render(["parent"]);
  await act(async () => finishOld([child("stale-child")]));
  expect(mocks.upsert.mock.calls.map(([row]) => row.session_id)).toEqual([
    "fresh-child",
  ]);
  expect(fetched.get("parent")?.map((row) => row.session_id)).toEqual([
    "fresh-child",
  ]);
});

it("bounds active queries across inventory changes and performs no work with no views", async () => {
  const pending: Array<() => void> = [];
  mocks.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        pending.push(() => resolve([]));
      })
  );
  await render(Array.from({ length: 12 }, (_, i) => `old-${i}`));
  expect(mocks.invoke).toHaveBeenCalledTimes(8);
  await render(["new-parent"]);
  expect(mocks.invoke).toHaveBeenCalledTimes(8);
  await act(async () => pending.splice(0).forEach((resolve) => resolve()));
  expect(mocks.invoke).toHaveBeenCalledTimes(9);
  expect(mocks.invoke).toHaveBeenLastCalledWith("es_get_child_sessions", {
    parentSessionId: "new-parent",
  });
  await render(["hidden-parent"], false);
  await act(async () => pending.splice(0).forEach((resolve) => resolve()));
  expect(mocks.invoke).toHaveBeenCalledTimes(9);
  expect(fetched.size).toBe(0);
  await render(["hidden-parent"], true);
  expect(mocks.invoke).toHaveBeenCalledTimes(10);
  await act(async () => pending.splice(0).forEach((resolve) => resolve()));
  await render(["hidden-parent"], true);
  expect(mocks.invoke).toHaveBeenCalledTimes(10);
});

it("unmount retires pending queries before the producing upsert boundary", async () => {
  let finish!: (records: ReturnType<typeof child>[]) => void;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render(["parent"]);
  await root.unmount();
  await act(async () => finish([child("late-child")]));
  expect(mocks.upsert).not.toHaveBeenCalled();
  root = createSmokeRoot();
});
