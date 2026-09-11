import { useEffect, useMemo, useState } from "react";

import { createLogger } from "@src/hooks/logger";
import {
  loadWorkingTreeDiff,
  releaseWorkingTreeDiff,
} from "@src/services/git/workingTreeDiffResource";
import type { GitFile } from "@src/types/git/types";

const log = createLogger("FileGitBaseline");

/** Status is metadata only. Load HEAD on demand for the active file editor. */
export function useFileGitBaseline(
  file: GitFile | undefined,
  repoPath: string,
  isActive: boolean,
  savedContent: string
) {
  const key =
    file && repoPath
      ? JSON.stringify([
          repoPath,
          file.path,
          file.original_path,
          file.status,
          file.staged,
          file.repoRoot,
        ])
      : null;
  const request = useMemo(() => {
    if (!key) return null;
    const [root, path, original_path, status, staged, repoRoot] =
      JSON.parse(key);
    return {
      repoPath: root,
      file: { path, original_path, status, staged, repoRoot },
    };
  }, [key]);
  const [loaded, setLoaded] = useState<{ key: string; content: string } | null>(
    null
  );
  const supplied = file?.oldContent;
  const added = file?.status === "added";

  useEffect(() => {
    if (!isActive || !request || !key || supplied !== undefined || added)
      return;
    let cancelled = false;
    loadWorkingTreeDiff(request)
      .then((diff) => {
        if (!cancelled && diff && !diff.binary) {
          setLoaded({ key, content: diff.oldContent });
        }
      })
      .catch((error) => {
        if (!cancelled) log.warn("Unable to load HEAD baseline", error);
      });
    return () => {
      cancelled = true;
      releaseWorkingTreeDiff(request);
    };
  }, [isActive, request, key, supplied, added, savedContent]);

  if (added) return "";
  return supplied ?? (loaded?.key === key ? loaded?.content : undefined);
}
