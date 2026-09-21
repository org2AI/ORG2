/**
 * Time-range presets for the Usage dashboard. Resolves a preset to an
 * inclusive `[startMs, endMs]` window (epoch ms) passed to the backend.
 */

export type UsageRangePreset = "today" | "24h" | "7d" | "30d" | "all";

export const USAGE_RANGE_PRESETS: readonly UsageRangePreset[] = [
  "today",
  "24h",
  "7d",
  "30d",
  "all",
];

const DAY_MS = 86_400_000;

export interface ResolvedRange {
  startMs: number | null;
  endMs: number | null;
}

/** Resolve a preset against "now". `all` returns an open window (nulls). */
export function resolveUsageRange(
  preset: UsageRange,
  now: number = Date.now()
): ResolvedRange {
  if (typeof preset !== "string")
    return { startMs: preset.startMs, endMs: preset.endMs };
  switch (preset) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { startMs: start.getTime(), endMs: now };
    }
    case "24h":
      return { startMs: now - DAY_MS, endMs: now };
    case "7d":
      return { startMs: now - 7 * DAY_MS, endMs: now };
    case "30d":
      return { startMs: now - 30 * DAY_MS, endMs: now };
    case "all":
    default:
      return { startMs: null, endMs: null };
  }
}

/** Fixed inclusive window; endMs includes the entire selected end second. */
export interface CustomUsageRange {
  kind: "custom";
  startMs: number;
  endMs: number;
}

export type UsageRange = UsageRangePreset | CustomUsageRange;

export function toLocalDateTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Reject missing/normalized dates (including nonexistent local DST times). */
export function parseCustomUsageRange(
  start: string,
  end: string
): CustomUsageRange | null {
  const parse = (input: string): number | null => {
    // Some native date fields serialize whole seconds with a zero fraction.
    const value = input.replace(/\.0{1,3}$/, "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
    const normalized = value.length === 16 ? `${value}:00` : value;
    const ms = new Date(normalized).getTime();
    return Number.isFinite(ms) && toLocalDateTime(ms) === normalized
      ? ms
      : null;
  };
  const startMs = parse(start);
  const endMs = parse(end);
  if (startMs === null || endMs === null || startMs > endMs) return null;
  return { kind: "custom", startMs, endMs: endMs + 999 };
}
