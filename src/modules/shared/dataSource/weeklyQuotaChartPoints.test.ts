import { describe, expect, it } from "vitest";

import { weeklyQuotaChartPoints } from "./weeklyQuotaChartPoints";

const point = (
  capturedAt: number,
  remainingPercent: number,
  resetAt: string | null = null
) => ({ capturedAt, remainingPercent, resetAt });
describe("weeklyQuotaChartPoints", () => {
  it("keeps zero, full and unchanged readings", () => {
    const points = [point(0, 100), point(3600, 100), point(7200, 0)];
    expect(weeklyQuotaChartPoints(points)).toEqual(points);
  });
  it("leaves gaps for missed readings and weekly resets", () => {
    const points = [
      point(0, 40),
      point(10800, 10, "2026-09-08T00:00:00Z"),
      point(14400, 100, "2026-09-15T00:00:00Z"),
    ];
    expect(
      weeklyQuotaChartPoints(points).map((p) => p.remainingPercent)
    ).toEqual([40, null, 10, null, 100]);
  });
  it("breaks an exactly missed hour but tolerates ordinary scheduling drift", () => {
    expect(
      weeklyQuotaChartPoints([point(0, 90), point(7200, 80)]).map(
        (p) => p.remainingPercent
      )
    ).toEqual([90, null, 80]);
    expect(
      weeklyQuotaChartPoints([point(0, 90), point(3660, 80)]).map(
        (p) => p.remainingPercent
      )
    ).toEqual([90, 80]);
  });
});
