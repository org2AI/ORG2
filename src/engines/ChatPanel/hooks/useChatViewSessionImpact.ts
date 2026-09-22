/**
 * useChatViewSessionImpact
 *
 * The session summary (commit/file-change rollups) plus, for imported
 * sessions, the composer files-pill stats resolved from it.
 *
 * Imported sessions keep changing underneath the view: the external CLI keeps
 * writing and rescans refresh the cached row. Their summary is re-read when
 * that row refreshes or another assistant reply completes. Native pills read
 * edit artifacts, so one summary read per open suffices for them.
 */
import { useMemo } from "react";

import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import type { Session } from "@src/store/session";

import type { FileChangeVisibleStats } from "../InputArea/components/CompactFileChanges";
import { resolveImportedFileChangeStats } from "../chatViewFileChanges";
import { useChatViewOrgtrackSummary } from "./useChatViewOrgtrackSummary";

interface UseChatViewSessionImpactOptions {
  sessionId: string;
  isImportedHistory: boolean;
  session: Session | undefined;
  /** Latest completed assistant reply; only read for imported sessions. */
  assistantFingerprint: string | null;
}

export interface ChatViewSessionImpact {
  orgtrackSummary: CoreSessionSummary | null;
  /** Defined only for imported sessions. */
  resolvedFileChangeStats: FileChangeVisibleStats | undefined;
}

export function useChatViewSessionImpact({
  sessionId,
  isImportedHistory,
  session,
  assistantFingerprint,
}: UseChatViewSessionImpactOptions): ChatViewSessionImpact {
  const summaryReloadKey = isImportedHistory
    ? `${session?.updated_at ?? ""}\0${assistantFingerprint ?? ""}`
    : undefined;
  const orgtrackSummary = useChatViewOrgtrackSummary(
    sessionId,
    summaryReloadKey
  );

  const stats = isImportedHistory
    ? resolveImportedFileChangeStats({ summary: orgtrackSummary, session })
    : null;
  // Row upserts (debounced draft saves) and summary re-reads replace the
  // source objects; key the pill's identity to its numbers so they do not
  // re-render the whole composer.
  const count = stats?.count;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  const resolvedFileChangeStats = useMemo(
    () => (count === undefined ? undefined : { count, additions, deletions }),
    [count, additions, deletions]
  );

  return { orgtrackSummary, resolvedFileChangeStats };
}
