import { describe, expect, it } from "vitest";

import type { Session } from "@src/store/session";

import { projectTraySessions } from "./projection";

const labels = {
  pinned: "Pinned",
  unread: "Unread",
  running: "Running",
  recent: "Recent",
  untitled: "Untitled",
  markAllRead: "Mark all as read",
};
const row = (id: string, overrides: Partial<Session> = {}): Session =>
  ({
    session_id: id,
    name: id,
    status: "completed",
    updated_at: "2026-09-07T00:00:00Z",
    ...overrides,
  }) as Session;

describe("projectTraySessions", () => {
  it("projects real session titles into disjoint sidebar-state groups", () => {
    const result = projectTraySessions(
      [
        row("pinned", { pinned: true, status: "running" }),
        row("unread"),
        row("running", { status: "running" }),
        row("read"),
        row("archived", { status: "archived", pinned: true }),
      ],
      new Set(["read"]),
      labels
    );
    expect(
      result.map((section) => section.sessions.map((item) => item.id))
    ).toEqual([["pinned"], ["unread"], ["running"], ["read"]]);
    expect(result[0].sessions[0].title).toBe("pinned");
    expect(result.map((section) => section.expanded)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(result.map((section) => section.title)).toEqual([
      "Pinned (1)",
      "Unread (1)",
      "Running (1)",
      "Recent (1)",
    ]);
  });

  it("updates after rename, unpin, completion, read and deletion", () => {
    const initial = row("one", { pinned: true, status: "running" });
    expect(
      projectTraySessions([initial], new Set(), labels)[0].sessions
    ).toHaveLength(1);
    const completed = {
      ...initial,
      pinned: false,
      status: "completed" as const,
      name: "Renamed",
    };
    expect(
      projectTraySessions([completed], new Set(), labels)[1].sessions[0].title
    ).toBe("Renamed");
    expect(
      projectTraySessions([completed], new Set(["one"]), labels)[3].sessions
    ).toHaveLength(1);
    expect(
      projectTraySessions([], new Set(["one"]), labels).every(
        (section) => !section.sessions.length
      )
    ).toBe(true);
  });

  it("refreshes the count when an entry outside the visible five is deleted", () => {
    const sessions = Array.from({ length: 7 }, (_, i) => row(String(i)));
    const before = projectTraySessions(sessions, new Set(), labels)[1];
    const after = projectTraySessions(
      sessions.slice(0, 6),
      new Set(),
      labels
    )[1];
    expect(before.sessions).toEqual(after.sessions);
    expect(before.title).toBe("Unread (7)");
    expect(after.title).toBe("Unread (6)");
  });

  it("bounds every group to five and sorts by recency without changing the source", () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      row(String(i), {
        updated_at: `2026-09-07T00:00:${String(i).padStart(2, "0")}Z`,
      })
    );
    const result = projectTraySessions(sessions, new Set(), labels);
    expect(result[1].sessions.map((item) => item.id)).toEqual([
      "49",
      "48",
      "47",
      "46",
      "45",
    ]);
    expect(sessions[0].session_id).toBe("0");
    expect(result[1].title).toBe("Unread (50)");
    expect(result[1].markAllReadLabel).toBe("Mark all as read");
    expect(result.filter((section) => section.markAllReadLabel)).toHaveLength(
      1
    );
    expect(result[0].title).toBe("Pinned (0)");
    expect(
      projectTraySessions([], new Set(), labels).every(
        (section) => !section.markAllReadLabel
      )
    ).toBe(true);
  });
});
