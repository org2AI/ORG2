import type { GitHubIssueTimelineItem } from "@src/api/tauri/github";

/** Event types GitHub emits once per label even for a single bulk action. */
const GROUPABLE_LABEL_EVENTS = new Set(["labeled", "unlabeled"]);

/**
 * Max gap between consecutive same-actor label events that still counts as
 * "the same action". A clock-minute bucket would split a run at e.g.
 * `:34:59` → `:35:01` despite a 2-second gap, so this compares actual
 * elapsed time between consecutive events instead.
 */
const LABEL_GROUPING_WINDOW_MS = 2 * 60 * 1000;

export type IssueTimelineRow =
  | { kind: "single"; item: GitHubIssueTimelineItem }
  | {
      kind: "labelGroup";
      event: "labeled" | "unlabeled";
      actor: GitHubIssueTimelineItem["actor"];
      items: GitHubIssueTimelineItem[];
    };

function parseTimestamp(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const ms = Date.parse(createdAt);
  return Number.isNaN(ms) ? null : ms;
}

interface PendingGroup {
  event: string;
  actorLogin: string | null;
  lastAt: number | null;
  items: GitHubIssueTimelineItem[];
}

/**
 * Collapses consecutive `labeled`/`unlabeled` events from the same actor,
 * each no more than {@link LABEL_GROUPING_WINDOW_MS} apart, into one row.
 * GitHub's issue/PR timeline emits one event per label even when they were
 * all applied in a single bulk action, which otherwise reads as several
 * near-identical rows.
 */
export function groupIssueTimelineRows(
  timeline: GitHubIssueTimelineItem[]
): IssueTimelineRow[] {
  const pending: PendingGroup[] = [];

  for (const item of timeline) {
    const at = parseTimestamp(item.created_at);
    const actorLogin = item.actor?.login ?? null;
    const last = pending[pending.length - 1];
    const canJoin =
      last !== undefined &&
      GROUPABLE_LABEL_EVENTS.has(item.event) &&
      last.event === item.event &&
      last.actorLogin === actorLogin &&
      at !== null &&
      last.lastAt !== null &&
      at - last.lastAt <= LABEL_GROUPING_WINDOW_MS;

    if (canJoin && last) {
      last.items.push(item);
      last.lastAt = at;
      continue;
    }

    pending.push({ event: item.event, actorLogin, lastAt: at, items: [item] });
  }

  return pending.map(
    (group): IssueTimelineRow =>
      group.items.length > 1
        ? {
            kind: "labelGroup",
            event: group.event as "labeled" | "unlabeled",
            actor: group.items[0].actor,
            items: group.items,
          }
        : { kind: "single", item: group.items[0] }
  );
}
