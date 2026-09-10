import { describe, expect, it } from "vitest";

import { weeklyQuotaRange } from "./weeklyQuotaRange";

const day = 86400;
const end = Date.parse("2026-09-12T12:00:00Z") / 1000;
const point = (
  capturedAt: number,
  remainingPercent = 87,
  resetAt: string | null = new Date(end * 1000).toISOString()
) => ({ capturedAt, remainingPercent, resetAt });

describe("weeklyQuotaRange", () => {
  it("defaults to the provider's current seven-day cycle without inventing 100%", () => {
    const points = [
      point(end - 8 * day),
      point(end - 7 * day),
      point(end - day),
    ];
    const range = weeklyQuotaRange(points, end - day, 0);
    expect([range.start, range.end]).toEqual([end - 7 * day, end]);
    expect(range.points).toEqual(points.slice(1));
  });
  it("pages backward and clamps both navigation limits", () => {
    const points = [
      point(end - 20 * day),
      point(end - 10 * day),
      point(end - day),
    ];
    expect(weeklyQuotaRange(points, end - day, 1).points).toEqual([points[1]]);
    const oldest = weeklyQuotaRange(points, end - day, 99);
    expect(oldest.offset).toBe(2);
    expect(oldest.points).toEqual([points[0]]);
    expect(weeklyQuotaRange(points, end - day, -1).offset).toBe(0);
  });
  it("uses a rolling week for absent or invalid reset metadata", () => {
    for (const reset of [
      null,
      "invalid",
      new Date((end + 20 * day) * 1000).toISOString(),
    ]) {
      const points = [point(end - 8 * day, 90, reset), point(end, 0, reset)];
      const range = weeklyQuotaRange(points, end, 0);
      expect(range.end - range.start).toBe(7 * day);
      expect(range.points).toEqual([points[1]]);
    }
  });
  it("advances an expired cycle and leaves the new cycle empty", () => {
    const points = [point(end - day)];
    const range = weeklyQuotaRange(points, end, 0);
    expect([range.start, range.end]).toEqual([end, end + 7 * day]);
    expect(range.points).toEqual([]);
    expect(weeklyQuotaRange(points, end, 1).points).toEqual(points);
  });
  it("does not offer history navigation for an empty account", () => {
    expect(weeklyQuotaRange([], end, 10).maxOffset).toBe(0);
  });
});
