import type { Session } from "@src/store/session";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";
import { sessionLabel } from "@src/util/session/sessionLabel";
import { isSessionCompletedUnread } from "@src/util/session/sessionStatusDot";

export const TRAY_GROUPS = ["pinned", "unread", "running", "recent"] as const;
export type TrayGroup = (typeof TRAY_GROUPS)[number];
export interface TraySection {
  title: string;
  markAllReadLabel?: string;
  expanded?: boolean;
  sessions: { id: string; title: string }[];
}

/** Disjoint groups, newest first, with the same status semantics as the sidebar. */
export function projectTraySessions(
  sessions: readonly Session[],
  visited: ReadonlySet<string>,
  labels: Record<TrayGroup | "untitled" | "markAllRead", string>
): TraySection[] {
  const groups: Record<TrayGroup, TraySection> = {
    pinned: { title: labels.pinned, sessions: [] },
    unread: { title: labels.unread, sessions: [] },
    running: { title: labels.running, sessions: [] },
    recent: { title: labels.recent, sessions: [] },
  };
  const counts: Record<TrayGroup, number> = {
    pinned: 0,
    unread: 0,
    running: 0,
    recent: 0,
  };
  const sorted = [...sessions].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
  for (const session of sorted) {
    // Archived sessions are excluded from this actionable menu by design.
    if (session.status === "archived") continue;
    const group = session.pinned
      ? "pinned"
      : isSessionInProgress(session.status)
        ? "running"
        : isSessionCompletedUnread(session, visited)
          ? "unread"
          : "recent";
    counts[group] += 1;
    const rows = groups[group].sessions;
    if (rows.length === 5) continue;
    rows.push({
      id: session.session_id,
      title: (sessionLabel(session, 80) || labels.untitled).replace(
        /\s+/g,
        " "
      ),
    });
  }
  return TRAY_GROUPS.map((group) => ({
    ...groups[group],
    title: `${groups[group].title} (${counts[group]})`,
    expanded: group === "running",
    ...(group === "unread" && counts[group] > 0
      ? { markAllReadLabel: labels.markAllRead }
      : {}),
  }));
}
