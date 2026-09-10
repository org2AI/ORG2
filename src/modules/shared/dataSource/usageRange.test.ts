import { describe, expect, it } from "vitest";

import {
  parseCustomUsageRange,
  resolveUsageRange,
  toLocalDateTime,
} from "./usageRange";

describe("custom usage range", () => {
  it("preserves local seconds and includes the complete end second", () => {
    const range = parseCustomUsageRange(
      "2026-09-07T04:08:18",
      "2026-09-07T04:08:19"
    );
    expect(range).toEqual({
      kind: "custom",
      startMs: new Date(2026, 8, 7, 4, 8, 18).getTime(),
      endMs: new Date(2026, 8, 7, 4, 8, 19, 999).getTime(),
    });
    expect(resolveUsageRange(range!, 0)).toEqual({
      startMs: range!.startMs,
      endMs: range!.endMs,
    });
    expect(toLocalDateTime(range!.endMs)).toBe("2026-09-07T04:08:19");
  });
  it("allows one second and browser values with omitted zero seconds", () => {
    const range = parseCustomUsageRange(
      "2026-09-07T04:08",
      "2026-09-07T04:08:00.000"
    );
    expect(range!.endMs - range!.startMs).toBe(999);
  });
  it.each([
    ["", "2026-09-07T04:08:19"],
    ["2026-09-07T04:08:20", "2026-09-07T04:08:19"],
    ["2026-02-30T04:08:18", "2026-09-07T04:08:19"],
    ["2026-09-07T25:08:18", "2026-09-07T04:08:19"],
    ["2026-09-07T04:08:18Z", "2026-09-07T04:08:19"],
  ])("rejects invalid or reversed inputs %s / %s", (start, end) => {
    expect(parseCustomUsageRange(start, end)).toBeNull();
  });
  it("keeps preset semantics", () => {
    const now = new Date(2026, 8, 7, 4, 8, 18).getTime();
    expect(resolveUsageRange("today", now)).toEqual({
      startMs: new Date(2026, 8, 7).getTime(),
      endMs: now,
    });
    expect(resolveUsageRange("24h", now)).toEqual({
      startMs: now - 86_400_000,
      endMs: now,
    });
    expect(resolveUsageRange("all", now)).toEqual({
      startMs: null,
      endMs: null,
    });
  });
});
