import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import type { Session } from "@src/store/session";

import type { FileChangeVisibleStats } from "./InputArea/components/CompactFileChanges";

type SummaryImpact = Pick<
  CoreSessionSummary,
  "filesChanged" | "linesAdded" | "linesRemoved"
>;
type SessionRowImpact = Pick<
  Session,
  "filesChanged" | "linesAdded" | "linesRemoved" | "touchedFiles"
>;

export const NO_FILE_CHANGE_STATS: FileChangeVisibleStats = {
  count: 0,
  additions: 0,
  deletions: 0,
};

function impactStats(
  count: number,
  additions: number,
  deletions: number
): FileChangeVisibleStats | undefined {
  return count > 0 || additions > 0 || deletions > 0
    ? { count, additions, deletions }
    : undefined;
}

/**
 * Composer files-pill stats for an imported (external-history or Cursor IDE)
 * session. The session summary is authoritative — the backend folds the
 * source parser's cached tally into it — and the sidebar row, when paged in,
 * is the instant value while the summary loads. Neither holding impact is a
 * final answer: imported sessions have no orgtrack edit artifacts to read.
 */
export function resolveImportedFileChangeStats({
  summary,
  session,
}: {
  summary: SummaryImpact | null;
  session: SessionRowImpact | undefined;
}): FileChangeVisibleStats {
  const touchedFileCount = session?.touchedFiles?.length ?? 0;
  return (
    (summary
      ? impactStats(
          summary.filesChanged,
          summary.linesAdded,
          summary.linesRemoved
        )
      : undefined) ??
    impactStats(
      touchedFileCount > 0 ? touchedFileCount : (session?.filesChanged ?? 0),
      session?.linesAdded ?? 0,
      session?.linesRemoved ?? 0
    ) ??
    NO_FILE_CHANGE_STATS
  );
}
