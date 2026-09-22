// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { Session } from "@src/store/session";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useSidebarRosterViewState } from "./useSidebarRosterViewState";

vi.mock("@src/features/Org2Cloud/org2CloudAuthAtom", async () => {
  const { atom } = await import("jotai");
  return {
    org2CloudAuthAtom: atom(null),
    org2CloudAuthIdentityKey: () => "user",
  };
});
let root: ReturnType<typeof createSmokeRoot>;
let state: ReturnType<typeof useSidebarRosterViewState>;
function Harness({ scope, sessions }: { scope: string; sessions: Session[] }) {
  const current = useSidebarRosterViewState(scope, sessions);
  useLayoutEffect(() => {
    state = current;
  }, [current]);
  return null;
}
const row = (id: string): Session => ({
  session_id: id,
  name: id,
  status: "completed",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z",
  repoPath: `/repo/${id}`,
});
afterEach(async () => {
  await root.unmount();
});

it("physically evicts deleted sessions/groups and resets scope without restoring stale intent on return", async () => {
  root = createSmokeRoot();
  const render = (scope: string, ids: string[]) =>
    root.render(createElement(Harness, { scope, sessions: ids.map(row) }));
  await render("a", ["first", "second"]);
  await act(async () => {
    state.setGroupVisibleCounts(
      new Map([
        ["workspace:/repo/first", 40],
        ["workspace:/repo/second", 40],
      ])
    );
    state.setExpandedSubagentParentIds(new Set(["first", "second"]));
  });
  await render("a", ["second"]);
  expect([...state.expandedSubagentParentIds]).toEqual(["second"]);
  expect([...state.groupVisibleCounts.keys()]).toEqual([
    "workspace:/repo/second",
  ]);
  await render("a", ["first", "second"]);
  expect(state.expandedSubagentParentIds.has("first")).toBe(false);
  expect(state.groupVisibleCounts.has("workspace:/repo/first")).toBe(false);
  await render("b", ["second"]);
  expect(state.expandedSubagentParentIds.size).toBe(0);
  expect(state.groupVisibleCounts.size).toBe(0);
  await render("a", ["second"]);
  expect(state.expandedSubagentParentIds.size).toBe(0);
});

it("caps retained intent even if the authoritative loaded inventory keeps growing", async () => {
  root = createSmokeRoot();
  const ids = Array.from({ length: 300 }, (_, i) => `s-${i}`);
  await root.render(
    createElement(Harness, { scope: "a", sessions: ids.map(row) })
  );
  await act(async () => {
    state.setGroupVisibleCounts(
      new Map(ids.map((id) => [`workspace:/repo/${id}`, 40]))
    );
    state.setExpandedSubagentParentIds(new Set(ids));
  });
  expect(state.expandedSubagentParentIds.size).toBe(256);
  expect(state.groupVisibleCounts.size).toBe(256);
  expect(state.expandedSubagentParentIds.has("s-299")).toBe(true);
  expect(state.expandedSubagentParentIds.has("s-0")).toBe(false);
});
