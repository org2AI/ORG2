import { describe, expect, it } from "vitest";

import type { MobileSessionRow } from "../connection/types";
import { groupMobileSessions } from "./sessionGrouping";

const now = new Date(2026, 8, 9, 12).getTime();
function row(id: string, updatedAtMs?: number): MobileSessionRow {
  return { id, name: id, status: "idle", repoName: "Workspace", updatedAtMs };
}

describe("groupMobileSessions", () => {
  it("groups by path, keeps same-name workspaces distinct, and preserves canonical rows", () => {
    const rows = [
      { ...row("a"), repoPath: "/first/app", repoName: "App" },
      { ...row("b"), repoPath: "/second/app", repoName: "App" },
      { ...row("c"), repoPath: "/first/app", repoName: "App" },
      { ...row("legacy"), repoName: "App" },
      { ...row("missing"), repoName: null },
      { ...row("path-only"), repoPath: "/other", repoName: null },
    ];
    const original = structuredClone(rows);
    const groups = groupMobileSessions(rows, "workspace");
    expect(groups.map((group) => group.sessions.map((row) => row.id))).toEqual([
      ["a", "c"],
      ["b"],
      ["legacy"],
      ["missing"],
      ["path-only"],
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "App · /first/app",
      "App · /second/app",
      "App",
      undefined,
      "/other",
    ]);
    expect(new Set(groups.map((group) => group.id)).size).toBe(5);
    expect(groups[3].id).toBe("no_workspace");
    expect(groups[0].sessions[1]).toBe(rows[2]);
    expect(rows).toEqual(original);
    expect(groupMobileSessions(rows, "none")[0].sessions).toEqual(original);
    expect(groupMobileSessions([], "workspace")).toEqual([]);
  });

  it("keeps the default flat ordering and original metadata references", () => {
    const rows = [row("old", 0), row("new", now)];
    const [group] = groupMobileSessions(rows, "none", now);
    expect(group.id).toBe("all");
    expect(group.sessions).toEqual(rows);
    expect(group.sessions[0]).toBe(rows[0]);
    expect(group.sessions[0].repoName).toBe("Workspace");
  });

  it("groups on local calendar boundaries without changing within-group order", () => {
    const rows = [
      row("old", new Date(2026, 8, 8, 23, 59).getTime()),
      row("today-first", new Date(2026, 8, 9).getTime()),
      row("unknown"),
      row("today-second", now),
    ];
    expect(
      groupMobileSessions(rows, "time", now).map((group) => [
        group.id,
        group.sessions.map((session) => session.id),
      ])
    ).toEqual([
      ["today", ["today-first", "today-second"]],
      ["earlier", ["old"]],
      ["unknown", ["unknown"]],
    ]);
    expect(rows.map((session) => session.id)).toEqual([
      "old",
      "today-first",
      "unknown",
      "today-second",
    ]);
  });

  it("does not invent a date for missing, malformed, or future-day timestamps", () => {
    const rows = [
      row("missing"),
      row("nan", NaN),
      row("infinite", Infinity),
      row("invalid-date", 9e15),
      row("future", new Date(2026, 8, 10).getTime()),
    ];
    expect(groupMobileSessions(rows, "time", now)).toEqual([
      { id: "unknown", sessions: rows },
    ]);
  });

  it("has no phantom groups for empty lists and returns to the original order", () => {
    expect(groupMobileSessions([], "time", now)).toEqual([]);
    expect(groupMobileSessions([], "none", now)).toEqual([]);
    const rows = [row("old", 0), row("new", now)];
    groupMobileSessions(rows, "time", now);
    expect(groupMobileSessions(rows, "none", now)[0].sessions).toEqual(rows);
  });
});
