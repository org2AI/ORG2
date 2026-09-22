import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { createSystemPathSessionSource } from "@src/features/SessionCreator/utils/systemPathSource";
import {
  currentBranchAtom,
  selectedRepoAtom,
  selectedRepoIdAtom,
} from "@src/store/repo";
import { toRepoFileSystemPath } from "@src/store/repo/matchRepoByPath";
import { REPO_KIND } from "@src/store/repo/types";
import {
  SYSTEM_PATH_ID,
  type SessionSource,
  sessionSourceAtom,
} from "@src/store/session/creatorStateAtom";
import { isMultiRootWorkspaceAtom } from "@src/store/ui/workspaceFoldersAtom";
import {
  activeWorktreeAtom,
  primaryFolderAtom,
} from "@src/store/workspace/derived";

/** One source for the composer label and every launch path. A saved local
 * source selects a checkout; its saved branch is not a live HEAD snapshot.
 * Explicit worktree launch refs have their own worktreeLaunchSelectionAtom.
 */
export function useSessionCreatorSource({
  isOSMode,
  t,
}: {
  isOSMode: boolean;
  t: TFunction;
}) {
  const sessionSource = useAtomValue(sessionSourceAtom);
  const setSessionSource = useSetAtom(sessionSourceAtom);
  const repoId = useAtomValue(selectedRepoIdAtom);
  const repo = useAtomValue(selectedRepoAtom);
  const branch = useAtomValue(currentBranchAtom);
  const worktree = useAtomValue(activeWorktreeAtom);
  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const primaryFolder = useAtomValue(primaryFolderAtom);

  const effectiveSource = useMemo<SessionSource | null>(() => {
    let source = sessionSource;
    if (!source) {
      if (isOSMode) {
        return createSystemPathSessionSource({
          systemPathId: SYSTEM_PATH_ID.HOME,
          t,
        });
      }
      if (isMultiRoot && primaryFolder) {
        source = {
          type: "local",
          repoId: primaryFolder.repoId ?? primaryFolder.id,
          repoName: primaryFolder.name,
          repoPath: primaryFolder.path,
        };
      } else if (repoId && repo) {
        source = {
          type: "local",
          repoId,
          repoName: repo.name,
          repoPath: repo.path || repo.fs_uri,
        };
      } else {
        return null;
      }
    }

    const livePath = toRepoFileSystemPath(
      worktree?.path || repo?.path || repo?.fs_uri
    );
    const sourcePath = toRepoFileSystemPath(source.repoPath);
    if (
      source.type !== "local" ||
      !repoId ||
      source.repoId !== repoId ||
      !sourcePath ||
      sourcePath !== livePath
    ) {
      return source;
    }
    // An empty live branch means unresolved/detached/non-Git; never revive a
    // previously saved branch. No effect or localStorage write is needed.
    return {
      ...source,
      branch: repo?.kind === REPO_KIND.FOLDER ? undefined : branch || undefined,
    };
  }, [
    sessionSource,
    isOSMode,
    t,
    isMultiRoot,
    primaryFolder,
    repoId,
    repo,
    worktree,
    branch,
  ]);

  // Preserve the existing workspace-switch behavior for independent drafts.
  const previousRepoId = useRef(repoId);
  useEffect(() => {
    if (previousRepoId.current !== repoId) {
      previousRepoId.current = repoId;
      if (sessionSource && sessionSource.repoId !== repoId)
        setSessionSource(null);
    }
  }, [repoId, sessionSource, setSessionSource]);

  const setDraftBranch = useCallback(
    (nextBranch: string) => {
      if (!effectiveSource) return;
      setSessionSource({ ...effectiveSource, branch: nextBranch || undefined });
    },
    [effectiveSource, setSessionSource]
  );

  return { effectiveSource, setDraftBranch };
}
