import { useEffect, useMemo, useState } from "react";

import {
  getOrgtrackSessionEditArtifacts,
  getOrgtrackSessionFinalDiffs,
} from "@src/api/tauri/lineage";
import { createLogger } from "@src/hooks/logger";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import type {
  FileChangeInfo,
  FileChangesResult,
} from "./compactFileChangesHelpers";
import {
  mapEditArtifactsToFileChangeInfo,
  mapFinalDiffToFileChangeInfo,
} from "./compactFileChangesHelpers";

const logger = createLogger("CompactFileChanges");

const NO_FILES: FileChangeInfo[] = [];

export interface UseCompactFileDataOptions {
  sessionId: string | null;
  initialData?: FileChangesResult;
  /**
   * Idle-reload signal. The orgtrack final diffs are cached per session in
   * Rust, so without this the pill only refetches on session switch/remount
   * and the count goes stale as the agent edits more files across rounds.
   * Bumping this string (session changed / new round / agent idle) forces a
   * fresh read without hammering the backend on every streamed tick.
   */
  reloadKey?: string;
}

export interface UseCompactFileDataReturn {
  allFiles: FileChangeInfo[];
}

export function useCompactFileData({
  sessionId,
  initialData,
  reloadKey,
}: UseCompactFileDataOptions): UseCompactFileDataReturn {
  const [loaded, setLoaded] = useState<{
    sessionId: string;
    files: FileChangeInfo[];
  } | null>(null);

  useEffect(() => {
    // Only native runtimes write orgtrack edit artifacts. Imported sessions
    // hold at most leftovers of the removed on-demand analysis, so the read
    // is a guaranteed-empty round trip; their pill reads the session summary.
    if (initialData || !sessionId || isImportedHistorySession(sessionId)) {
      return;
    }

    let cancelled = false;
    void getOrgtrackSessionEditArtifacts({ sessionId })
      .then(async (editArtifacts) => {
        if (cancelled) return;
        const artifactFiles = mapEditArtifactsToFileChangeInfo(editArtifacts);
        if (artifactFiles.length > 0) {
          setLoaded({ sessionId, files: artifactFiles });
          return;
        }

        const finalDiffs = await getOrgtrackSessionFinalDiffs({ sessionId });
        if (cancelled) return;
        setLoaded({
          sessionId,
          files: finalDiffs.map(mapFinalDiffToFileChangeInfo),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          logger.warn("failed to load orgtrack edit artifacts or final diffs", {
            err,
            sessionId,
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // reloadKey already encodes sessionId; listed explicitly for clarity.
  }, [initialData, sessionId, reloadKey]);

  // Files read for another session never surface under this one — the
  // hook's host is not remounted on every session switch.
  const sessionFiles =
    sessionId && loaded?.sessionId === sessionId ? loaded.files : NO_FILES;
  const allFiles = useMemo(
    () => initialData?.files ?? sessionFiles,
    [initialData?.files, sessionFiles]
  );

  return { allFiles };
}
