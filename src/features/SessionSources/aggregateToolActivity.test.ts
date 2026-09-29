import { describe, expect, it } from "vitest";

import type { SessionToolActivity } from "@src/api/tauri/session/sessionSources";

import { aggregateToolActivity } from "./aggregateToolActivity";

const activity = (
  callId: string,
  patch: Partial<SessionToolActivity> = {}
): SessionToolActivity => ({
  callId,
  toolName: "mcp__cua_repl__js",
  group: "mcp:cua",
  status: "success",
  actions: [{ kind: "generic" }],
  ...patch,
});

describe("aggregateToolActivity", () => {
  it("merges49 equivalent calls but preserves count, call IDs and original facts", () => {
    const operations = Array.from({ length: 49 }, (_, index) =>
      activity(`call-${index}`)
    );
    const before = JSON.stringify(operations);
    const [category] = aggregateToolActivity(operations);
    expect(category.totalCount).toBe(49);
    expect(category.details).toHaveLength(1);
    expect(category.details[0]).toMatchObject({
      occurrenceCount: 49,
      callIds: operations.map((item) => item.callId),
    });
    expect(category.details[0].operation).toBe(operations[0]);
    expect(JSON.stringify(operations)).toBe(before);
  });
  it("keeps different tools, action kinds, queries, URLs, statuses and errors distinct", () => {
    const operations = [
      activity("base"),
      activity("tool", { toolName: "another_tool" }),
      activity("kind", { actions: [{ kind: "search" }] }),
      activity("query", { actions: [{ kind: "generic", query: "different" }] }),
      activity("url", {
        actions: [{ kind: "generic", url: "https://example.com" }],
      }),
      activity("status", { status: "error" }),
      activity("error-a", { status: "error", error: "Error A" }),
      activity("error-b", { status: "error", error: "Error B" }),
    ];
    const categories = aggregateToolActivity(operations);
    expect(categories.flatMap((category) => category.details)).toHaveLength(8);
    expect(
      categories.reduce((count, category) => count + category.totalCount, 0)
    ).toBe(8);
  });
  it("preserves latest-first row order and action totals including empty generic calls", () => {
    const [category] = aggregateToolActivity([
      activity("new-a", {
        actions: [
          { kind: "search", query: "A" },
          { kind: "search", query: "B" },
        ],
      }),
      activity("old-a", { actions: [{ kind: "search", query: "A" }] }),
    ]);
    expect(category.totalCount).toBe(3);
    expect(
      category.details.map((detail) => [
        detail.action.query,
        detail.occurrenceCount,
      ])
    ).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
    expect(
      aggregateToolActivity([activity("empty", { actions: [] })])[0]
    ).toMatchObject({ kind: "generic", totalCount: 1 });
  });
});
