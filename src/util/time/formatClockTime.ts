/**
 * Two timestamps closer than this render as a single HH:MM label instead of
 * a `start ~ end` range: a range whose endpoints round to the same minute
 * would read as `10:44 ~ 10:44`.
 */
export const MIN_TIME_RANGE_MS = 60_000;

/**
 * Locale-aware 24-hour wall-clock label (`HH:MM`) in the system zone.
 * Non-finite input and Intl failures both yield "" so callers can treat an
 * empty label as "no time to show".
 */
export function formatClockTime(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

/**
 * `HH:MM ~ HH:MM` range, collapsing to a single `HH:MM` when the endpoints
 * are less than {@link MIN_TIME_RANGE_MS} apart. Returns "" when either
 * endpoint cannot be formatted.
 */
export function formatClockRange(startMs: number, endMs: number): string {
  const startClock = formatClockTime(startMs);
  if (!startClock) return "";
  if (endMs - startMs < MIN_TIME_RANGE_MS) return startClock;

  const endClock = formatClockTime(endMs);
  if (!endClock) return "";

  return `${startClock} ~ ${endClock}`;
}
