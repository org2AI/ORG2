/**
 * Custom memo comparison for `GitDiffContent` - prevents rerenders on
 * callback reference changes. Data props are compared strictly, `gitFile`
 * by its key values, and callbacks only by presence.
 */
import type { GitDiffContentProps } from "./types";

export function arePropsEqual(
  prevProps: GitDiffContentProps,
  nextProps: GitDiffContentProps
): boolean {
  // Compare data props strictly
  if (prevProps.loading !== nextProps.loading) return false;
  if (prevProps.repoPath !== nextProps.repoPath) return false;

  // Compare gitFile by its key values, not reference
  const prevFile = prevProps.gitFile;
  const nextFile = nextProps.gitFile;

  if (!prevFile && !nextFile) {
    // Both null, consider equal
  } else if (!prevFile || !nextFile) {
    return false; // One null, one not
  } else {
    // Compare by actual content
    if (prevFile.path !== nextFile.path) return false;
    if (prevFile.oldContent !== nextFile.oldContent) return false;
    if (prevFile.newContent !== nextFile.newContent) return false;
    if (prevFile.status !== nextFile.status) return false;
  }

  // Only check callback existence, not reference
  if (!!prevProps.onResolveConflict !== !!nextProps.onResolveConflict)
    return false;
  if (!!prevProps.onContentChange !== !!nextProps.onContentChange) return false;
  if (!!prevProps.onReload !== !!nextProps.onReload) return false;
  if (!!prevProps.onUnsavedChange !== !!nextProps.onUnsavedChange) return false;
  if (!!prevProps.onClose !== !!nextProps.onClose) return false;
  if (prevProps.leadingHeaderSlot !== nextProps.leadingHeaderSlot) return false;
  if (
    prevProps.publishHeaderToWorkstation !==
    nextProps.publishHeaderToWorkstation
  )
    return false;
  if (!!prevProps.emptyState !== !!nextProps.emptyState) return false;
  return true;
}
