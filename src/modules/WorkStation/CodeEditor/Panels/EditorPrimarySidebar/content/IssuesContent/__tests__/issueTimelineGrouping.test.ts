import { describe, expect, it } from "vitest";

import type { GitHubIssueTimelineItem } from "@src/api/tauri/github";

import { groupIssueTimelineRows } from "../issueTimelineGrouping";

function timelineItem(
  overrides: Partial<GitHubIssueTimelineItem>
): GitHubIssueTimelineItem {
  return {
    id: 1,
    event: "labeled",
    created_at: "2026-09-13T02:34:00Z",
    actor: { login: "ShiboSheng", avatar_url: "" },
    body: null,
    html_url: null,
    assignee: null,
    label: { name: "bug", color: "d73a4a" },
    milestone: null,
    rename: null,
    source: null,
    commit_id: null,
    lock_reason: null,
    ...overrides,
  };
}

describe("groupIssueTimelineRows", () => {
  it("collapses same-actor label events within the grouping window into one row", () => {
    const items = [
      timelineItem({
        id: 1,
        created_at: "2026-09-13T02:34:05Z",
        label: { name: "bug", color: "d73a4a" },
      }),
      timelineItem({
        id: 2,
        created_at: "2026-09-13T02:34:22Z",
        label: { name: "UX", color: "purple" },
      }),
      timelineItem({
        id: 3,
        created_at: "2026-09-13T02:34:59Z",
        label: { name: "chat", color: "green" },
      }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "labelGroup", event: "labeled" });
    expect(rows[0].kind === "labelGroup" && rows[0].items).toHaveLength(3);
  });

  it("groups a run that crosses a clock-minute boundary within the window", () => {
    // 2 seconds apart, but on either side of :35:00 — a minute-bucket
    // comparison would wrongly split this into two rows.
    const items = [
      timelineItem({ id: 1, created_at: "2026-09-13T02:34:59Z" }),
      timelineItem({ id: 2, created_at: "2026-09-13T02:35:01Z" }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("labelGroup");
  });

  it("still groups at exactly the 2-minute boundary", () => {
    const items = [
      timelineItem({ id: 1, created_at: "2026-09-13T02:34:00Z" }),
      timelineItem({ id: 2, created_at: "2026-09-13T02:36:00Z" }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("labelGroup");
  });

  it("keeps events more than 2 minutes apart as separate rows", () => {
    const items = [
      timelineItem({ id: 1, created_at: "2026-09-13T02:34:00Z" }),
      timelineItem({ id: 2, created_at: "2026-09-13T02:36:00.001Z" }),
      timelineItem({ id: 3, created_at: "2026-09-14T11:23:00Z" }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.kind === "single")).toBe(true);
  });

  it("extends the window across a whole chain of sub-2-minute gaps", () => {
    // Each gap is under 2 minutes, but the first and last events here are
    // over 3 minutes apart — the window slides with the chain instead of
    // being capped from the first event.
    const items = [
      timelineItem({ id: 1, created_at: "2026-09-13T02:00:00Z" }),
      timelineItem({ id: 2, created_at: "2026-09-13T02:01:30Z" }),
      timelineItem({ id: 3, created_at: "2026-09-13T02:03:00Z" }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "labelGroup" && rows[0].items).toHaveLength(3);
  });

  it("keeps events from different actors within the window as separate rows", () => {
    const items = [
      timelineItem({
        id: 1,
        created_at: "2026-09-13T02:34:05Z",
        actor: { login: "ShiboSheng", avatar_url: "" },
      }),
      timelineItem({
        id: 2,
        created_at: "2026-09-13T02:34:22Z",
        actor: { login: "Harry19081", avatar_url: "" },
      }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(2);
  });

  it("never merges a labeled run with an unlabeled run", () => {
    const items = [
      timelineItem({
        id: 1,
        created_at: "2026-09-13T02:34:05Z",
        event: "labeled",
      }),
      timelineItem({
        id: 2,
        created_at: "2026-09-13T02:34:10Z",
        event: "unlabeled",
      }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "single")).toBe(true);
  });

  it("never groups non-label events, even from the same actor within the window", () => {
    const items = [
      timelineItem({
        id: 1,
        created_at: "2026-09-13T02:34:05Z",
        event: "assigned",
        label: null,
      }),
      timelineItem({
        id: 2,
        created_at: "2026-09-13T02:34:10Z",
        event: "assigned",
        label: null,
      }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "single")).toBe(true);
  });

  it("interleaved comments break an otherwise-groupable label run", () => {
    const items = [
      timelineItem({ id: 1, created_at: "2026-09-13T02:34:05Z" }),
      timelineItem({
        id: 2,
        created_at: "2026-09-13T02:34:10Z",
        event: "commented",
        label: null,
      }),
      timelineItem({ id: 3, created_at: "2026-09-13T02:34:15Z" }),
    ];

    const rows = groupIssueTimelineRows(items);

    expect(rows.map((row) => row.kind)).toEqual(["single", "single", "single"]);
  });
});
