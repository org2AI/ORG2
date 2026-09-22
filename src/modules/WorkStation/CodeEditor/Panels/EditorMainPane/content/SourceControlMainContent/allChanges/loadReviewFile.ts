import { readTextFile } from "@tauri-apps/plugin-fs";

import type { ReviewSearchFile } from "@src/modules/WorkStation/shared/DiffSectionList/search/reviewSearchTypes";
import { loadWorkingTreeDiff } from "@src/services/git/workingTreeDiffResource";
import type { GitFile } from "@src/types/git/types";

import { getEffectiveRepoPath } from "./utils";

/** Use the bounded shared resource without expanding or retaining every row. */
export async function loadReviewFile(
  file: GitFile,
  repoPath: string,
  repoId?: string
): Promise<ReviewSearchFile | null> {
  const effectivePath = getEffectiveRepoPath(file, repoPath);
  const diff = await loadWorkingTreeDiff({
    repoId: repoId ?? effectivePath,
    repoPath: effectivePath,
    file,
  });
  if (diff)
    return {
      path: file.path,
      oldContent: diff.oldContent,
      newContent: diff.newContent,
      isBinary: diff.binary,
    };
  if (file.status !== "added") return null;
  const normalized = file.path.replace(/\\/g, "/");
  const absolute =
    normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)
      ? file.path
      : `${effectivePath}/${file.path}`;
  return {
    path: file.path,
    oldContent: "",
    newContent: await readTextFile(absolute),
  };
}
