/**
 * `m:ss` for the unlock throttle countdown. Seconds are clamped at zero so a
 * late tick can never render a negative time.
 */
export function formatRetryCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
