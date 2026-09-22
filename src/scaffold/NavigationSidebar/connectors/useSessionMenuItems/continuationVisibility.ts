import type { Session } from "@src/store/session";

/** Same order as the backend election: `updated_at`, then the id. */
function isNewerContinuationRow(candidate: Session, current: Session): boolean {
  const byTime = (candidate.updated_at || "").localeCompare(
    current.updated_at || ""
  );
  if (byTime !== 0) return byTime > 0;
  return candidate.session_id.localeCompare(current.session_id) > 0;
}

/**
 * One visible row per continuation lineage. Callers pass only the rows
 * that are otherwise eligible for display, so a cached row that already
 * left the authoritative roster can never outrank the row the backend
 * returned. Explicitly revealed rows (the
 * open session and its reveal request) always win their lineage; otherwise
 * the newest row does. Rows without a lineage are never affected. This
 * covers the window between a backend demotion and the next roster merge
 * that prunes the demoted sibling.
 */
export function continuationWinnerIds(
  sessions: readonly Session[],
  revealedSessionIds: ReadonlySet<string>
): ReadonlySet<string> {
  const revealedByLineage = new Map<string, string[]>();
  const newestByLineage = new Map<string, Session>();
  for (const session of sessions) {
    const lineageId = session.continuationLineageId;
    if (!lineageId) continue;
    if (revealedSessionIds.has(session.session_id)) {
      const ids = revealedByLineage.get(lineageId) ?? [];
      ids.push(session.session_id);
      revealedByLineage.set(lineageId, ids);
    }
    const current = newestByLineage.get(lineageId);
    if (!current || isNewerContinuationRow(session, current)) {
      newestByLineage.set(lineageId, session);
    }
  }
  const winners = new Set<string>();
  for (const [lineageId, newest] of newestByLineage) {
    const revealed = revealedByLineage.get(lineageId);
    if (revealed) {
      for (const id of revealed) winners.add(id);
    } else {
      winners.add(newest.session_id);
    }
  }
  return winners;
}

export function isHiddenContinuationSibling(
  session: Session,
  winnerIds: ReadonlySet<string>
): boolean {
  return Boolean(
    session.continuationLineageId && !winnerIds.has(session.session_id)
  );
}
