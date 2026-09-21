import type { MobileSessionRow } from "../connection/types";

export type SessionGroupBy = "none" | "time" | "workspace";
export type MobileSessionGroupId =
  | "all"
  | "today"
  | "earlier"
  | "unknown"
  | "no_workspace"
  | `workspace:${string}`;

export interface MobileSessionGroup {
  id: MobileSessionGroupId;
  label?: string;
  sessions: MobileSessionRow[];
}

/** Presentation only: preserve canonical row metadata and order within each group. */
export function groupMobileSessions(
  sessions: readonly MobileSessionRow[],
  groupBy: SessionGroupBy,
  now = Date.now()
): MobileSessionGroup[] {
  if (sessions.length === 0) return [];
  if (groupBy === "none") return [{ id: "all", sessions: [...sessions] }];
  if (groupBy === "workspace") {
    const groups = new Map<string, MobileSessionGroup>();
    for (const session of sessions) {
      const path = session.repoPath?.trim();
      const name = session.repoName?.trim();
      const id: MobileSessionGroupId = path
        ? `workspace:${JSON.stringify(["path", path])}`
        : name
          ? `workspace:${JSON.stringify(["name", name])}`
          : "no_workspace";
      let group = groups.get(id);
      if (!group) {
        group = { id, label: name || path || undefined, sessions: [] };
        groups.set(id, group);
      }
      group.sessions.push(session);
    }
    // Distinct paths may have the same display name. Keep their headings distinct too.
    const labels = new Map<string, number>();
    for (const group of groups.values()) {
      if (group.label)
        labels.set(group.label, (labels.get(group.label) ?? 0) + 1);
    }
    for (const group of groups.values()) {
      if (group.label && (labels.get(group.label) ?? 0) > 1) {
        const path = group.sessions[0].repoPath?.trim();
        if (path) group.label = `${group.label} · ${path}`;
      }
    }
    return [...groups.values()];
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const groups: MobileSessionGroup[] = [
    { id: "today", sessions: [] },
    { id: "earlier", sessions: [] },
    { id: "unknown", sessions: [] },
  ];

  for (const session of sessions) {
    const timestamp = session.updatedAtMs;
    const valid =
      typeof timestamp === "number" &&
      Number.isFinite(timestamp) &&
      !Number.isNaN(new Date(timestamp).getTime());
    const index =
      !valid || timestamp >= tomorrow.getTime()
        ? 2
        : timestamp >= today.getTime()
          ? 0
          : 1;
    groups[index].sessions.push(session);
  }

  return groups.filter((group) => group.sessions.length > 0);
}
