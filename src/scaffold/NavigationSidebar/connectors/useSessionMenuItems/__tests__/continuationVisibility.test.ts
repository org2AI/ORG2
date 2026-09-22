import { describe, expect, it } from "vitest";

import type { Session } from "@src/store/session";

import {
  continuationWinnerIds,
  isHiddenContinuationSibling,
} from "../continuationVisibility";

function session(sessionId: string, continuationLineageId?: string): Session {
  return {
    session_id: sessionId,
    status: "completed",
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
    continuationLineageId,
  };
}

describe("continuationWinnerIds", () => {
  function dated(
    sessionId: string,
    lineage: string | undefined,
    updatedAt: string
  ): Session {
    return { ...session(sessionId, lineage), updated_at: updatedAt };
  }

  it("shows only the newest row of a lineage when nothing is revealed", () => {
    const rows = [
      dated("gen1", "lineage-a", "2026-09-11T00:18:38.000Z"),
      dated("gen2", "lineage-a", "2026-09-11T00:29:51.000Z"),
      dated("plain", undefined, "2026-09-11T00:00:00.000Z"),
    ];
    const winners = continuationWinnerIds(rows, new Set());
    expect(winners).toEqual(new Set(["gen2"]));
    expect(isHiddenContinuationSibling(rows[0], winners)).toBe(true);
    expect(isHiddenContinuationSibling(rows[1], winners)).toBe(false);
    expect(isHiddenContinuationSibling(rows[2], winners)).toBe(false);
  });

  it("breaks an updated_at tie by id, like the backend election", () => {
    // The lower id comes first so insertion order alone would pick it.
    const rows = [
      dated("codexapp-rollout-a", "lineage-a", "2026-09-11T00:18:38.000Z"),
      dated("codexapp-rollout-b", "lineage-a", "2026-09-11T00:18:38.000Z"),
    ];
    expect(continuationWinnerIds(rows, new Set())).toEqual(
      new Set(["codexapp-rollout-b"])
    );
  });

  it("lets a revealed older generation win its lineage", () => {
    const rows = [
      dated("gen1", "lineage-a", "2026-09-11T00:18:38.000Z"),
      dated("gen2", "lineage-a", "2026-09-11T00:29:51.000Z"),
    ];
    const winners = continuationWinnerIds(rows, new Set(["gen1"]));
    expect(winners).toEqual(new Set(["gen1"]));
    expect(isHiddenContinuationSibling(rows[1], winners)).toBe(true);
  });
});
