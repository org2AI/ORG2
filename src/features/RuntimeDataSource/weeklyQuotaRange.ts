import type { WeeklyQuotaHistory } from "@src/api/tauri/rpc/schemas/weeklyQuotaHistory";

const WEEK = 7 * 24 * 3600;

/** Use the provider's reset boundary; never manufacture a 100% observation. */
export function weeklyQuotaRange(
  points: WeeklyQuotaHistory[number]["points"],
  now: number,
  requestedOffset: number
) {
  const latest = points.at(-1);
  const reset = latest?.resetAt ? Date.parse(latest.resetAt) / 1000 : NaN;
  const validReset =
    latest &&
    Number.isFinite(reset) &&
    reset > latest.capturedAt &&
    reset - latest.capturedAt <= WEEK;
  // Without reset metadata, use a rolling seven-day window including `now`.
  const currentEnd = validReset
    ? reset + Math.max(0, Math.floor((now - reset) / WEEK) + 1) * WEEK
    : now + 1;
  const earliest = Math.max(points[0]?.capturedAt ?? now, now - 4 * WEEK);
  const maxOffset = Math.max(
    0,
    Math.ceil((currentEnd - WEEK - earliest) / WEEK)
  );
  const offset = Math.min(maxOffset, Math.max(0, requestedOffset));
  const end = currentEnd - offset * WEEK;
  const start = end - WEEK;
  return {
    start,
    end,
    offset,
    maxOffset,
    points: points.filter(
      (point) =>
        point.capturedAt >= start &&
        point.capturedAt < end &&
        point.capturedAt <= now
    ),
  };
}
