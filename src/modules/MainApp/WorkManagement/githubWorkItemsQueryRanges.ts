import type { GitHubQueryRange } from "./githubWorkItemsSearchQuery";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_AGE_UNIT_MS: Record<string, number> = {
  h: HOUR_MS,
  d: DAY_MS,
  w: 7 * DAY_MS,
  m: 30 * DAY_MS,
  y: 365 * DAY_MS,
};
const RELATIVE_AGE_PATTERN = /^(\d+)([hdwmy])$/i;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ResolvedInstant {
  start: number;
  end: number;
  /** Relative ages ("7d") name one instant, not a whole calendar day. */
  relative: boolean;
}

function resolveInstant(operand: string, now: number): ResolvedInstant | null {
  const relative = RELATIVE_AGE_PATTERN.exec(operand);
  if (relative) {
    const instant =
      now -
      Number(relative[1]) * RELATIVE_AGE_UNIT_MS[relative[2].toLowerCase()];
    return { start: instant, end: instant, relative: true };
  }
  const calendar = CALENDAR_DATE_PATTERN.exec(operand);
  if (calendar) {
    const start = new Date(
      Number(calendar[1]),
      Number(calendar[2]) - 1,
      Number(calendar[3])
    ).getTime();
    return { start, end: start + DAY_MS - 1, relative: false };
  }
  const timestamp = Date.parse(operand);
  if (Number.isNaN(timestamp)) return null;
  return { start: timestamp, end: timestamp, relative: false };
}

/**
 * Compares an ISO timestamp with a date range. A relative age resolves to
 * `now - age`, so `updated:>7d` keeps items touched within the last week and
 * `updated:<30d` keeps items untouched for a month. A range that cannot be
 * resolved matches nothing rather than silently passing everything.
 */
export function matchesGitHubDateRange(
  value: string,
  range: GitHubQueryRange,
  now: number = Date.now()
): boolean {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  if (range.kind === "between") {
    const from = resolveInstant(range.from, now);
    const to = resolveInstant(range.to, now);
    if (!from || !to) return false;
    return timestamp >= from.start && timestamp <= to.end;
  }
  const instant = resolveInstant(range.operand, now);
  if (!instant) return false;
  if (range.kind === "exact") {
    return instant.relative
      ? timestamp >= instant.start
      : timestamp >= instant.start && timestamp <= instant.end;
  }
  if (range.operator === ">") return timestamp > instant.end;
  if (range.operator === ">=") return timestamp >= instant.start;
  if (range.operator === "<") return timestamp < instant.start;
  return timestamp <= instant.end;
}

function parseCount(operand: string): number | null {
  return /^\d+$/.test(operand) ? Number(operand) : null;
}

export function matchesGitHubNumberRange(
  value: number,
  range: GitHubQueryRange
): boolean {
  if (range.kind === "between") {
    const from = parseCount(range.from);
    const to = parseCount(range.to);
    return from !== null && to !== null && value >= from && value <= to;
  }
  const operand = parseCount(range.operand);
  if (operand === null) return false;
  if (range.kind === "exact") return value === operand;
  if (range.operator === ">") return value > operand;
  if (range.operator === ">=") return value >= operand;
  if (range.operator === "<") return value < operand;
  return value <= operand;
}
