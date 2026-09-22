/**
 * In-progress edits made in a working-tree diff editor (`GitDiffContent`).
 *
 * The diff editor is unmounted whenever its tab stops being active — the
 * Source Control Focus view and `git-diff` tabs are rebuilt from stores on
 * every visit rather than hidden behind `display:none`. Component-local
 * `editedContent` died with the subtree, so switching to another tab and
 * back silently discarded unsaved edits while the tab bar kept showing the
 * unsaved dot. The draft now lives here, keyed by the absolute file path.
 *
 * Invariant: a draft is only ever restored onto the working-tree content it
 * was written against. `restoreGitDiffEditDraft` compares the stored base with
 * the current content and discards the draft when they differ (the file was
 * saved or changed on disk in between), so a stale draft can never resurrect
 * over newer content. Saving acknowledges the actual disk baseline while
 * preserving newer edits; discarding in the editor deletes the draft;
 * closing a `git-diff` tab deletes its file's draft (close means discard,
 * matching the pre-existing close behaviour).
 */
import { readTextFile } from "@tauri-apps/plugin-fs";

import { updateTextFileSerial } from "@src/services/file/writeTextFileSerial";
import { BoundedMap } from "@src/util/collections/BoundedMap";

export interface GitDiffEditDraft {
  /** Working-tree content the edit started from. */
  baseContent: string;
  /** The user's edited buffer. */
  editedContent: string;
}

/** Files with a live draft at once; the LRU tail is dropped beyond this. */
export const MAX_GIT_DIFF_EDIT_DRAFTS = 32;

const drafts = new BoundedMap<string, GitDiffEditDraft>({
  maxSize: MAX_GIT_DIFF_EDIT_DRAFTS,
  name: "gitDiffEditDrafts",
});

/** Record the current edit buffer for `filePath` against `baseContent`. */
export function setGitDiffEditDraft(
  filePath: string,
  baseContent: string,
  editedContent: string
): void {
  if (!filePath) return;
  if (editedContent === baseContent) {
    drafts.delete(filePath);
    return;
  }
  drafts.set(filePath, { baseContent, editedContent });
}

/**
 * Return the draft for `filePath` when it was written against
 * `baseContent`; otherwise drop the stale draft and return `null`.
 */
export function restoreGitDiffEditDraft(
  filePath: string,
  baseContent: string
): string | null {
  const draft = drafts.get(filePath);
  if (!draft) return null;
  if (draft.baseContent !== baseContent) {
    drafts.delete(filePath);
    return null;
  }
  return draft.editedContent;
}

/** Forget the draft for `filePath` (save, discard, tab close). */
export function deleteGitDiffEditDraft(filePath: string): void {
  drafts.delete(filePath);
}

/** A completed write changes the disk baseline, never a newer draft body. */
export function acknowledgeGitDiffSave(
  filePath: string,
  savedContent: string,
  clearSavedDraft: boolean
): void {
  const draft = drafts.get(filePath);
  if (!draft) return;
  // Content equality is sufficient here: there are no remaining unsaved bytes.
  if (clearSavedDraft && draft.editedContent === savedContent) {
    drafts.delete(filePath);
  } else {
    drafts.set(filePath, { ...draft, baseContent: savedContent });
  }
}

/** A mounted editor may outlive another owner's pending save of this file. */
export function getGitDiffEditDraftBaseline(
  filePath: string
): string | undefined {
  return drafts.get(filePath)?.baseContent;
}

export function hasGitDiffEditDraft(filePath: string): boolean {
  return drafts.has(filePath);
}

export function clearGitDiffEditDrafts(): void {
  drafts.clear();
}

export function getGitDiffDraftPaths(): string[] {
  return [...drafts.keys()];
}

export async function saveGitDiffDraftForSwitch(
  filePath: string
): Promise<void> {
  const draft = drafts.get(filePath);
  if (!draft) throw new Error(`No saved editor buffer was found: ${filePath}`);
  await updateTextFileSerial(filePath, async (target) => {
    if ((await readTextFile(target)) !== draft.baseContent)
      throw new Error(`File changed on disk: ${filePath}`);
    return draft.editedContent;
  });
  if ((await readTextFile(filePath)) !== draft.editedContent)
    throw new Error(`File changed while saving: ${filePath}`);
  const unchanged = drafts.get(filePath) === draft;
  acknowledgeGitDiffSave(filePath, draft.editedContent, unchanged);
  if (!unchanged) throw new Error(`Editor changed while saving: ${filePath}`);
}
