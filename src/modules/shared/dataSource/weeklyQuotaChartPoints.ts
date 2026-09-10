import type { WeeklyQuotaHistory } from "@src/api/tauri/rpc/schemas/weeklyQuotaHistory";

/** Break the line at missed hours and cycle changes rather than inventing consumption. */
export function weeklyQuotaChartPoints(
  points: WeeklyQuotaHistory[number]["points"]
) {
  return points.flatMap((point, index) => {
    const previous = points[index - 1];
    const resetChanged =
      previous?.resetAt &&
      point.resetAt &&
      Math.abs(Date.parse(point.resetAt) - Date.parse(previous.resetAt)) >
        5 * 60 * 1000;
    if (
      previous &&
      (point.capturedAt - previous.capturedAt > 90 * 60 || resetChanged)
    ) {
      return [
        {
          capturedAt: previous.capturedAt + 1,
          remainingPercent: null,
          resetAt: null,
        },
        point,
      ];
    }
    return [point];
  });
}
