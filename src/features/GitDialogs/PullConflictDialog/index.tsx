/**
 * PullConflictDialog
 *
 * Shown when git pull fails because local has uncommitted changes
 * that would be overwritten by incoming changes.
 * Uses native Tauri system dialog.
 *
 * @example
 * ```tsx
 * import { PullConflictDialog } from "@src/features/GitDialogs";
 *
 * const result = await PullConflictDialog.open({
 *   branchName: "main",
 *   conflictingFiles: ["src/index.ts"],
 * });
 *
 * if (result === "stash_pull") {
 *   // Stash changes then pull
 * } else if (result === "discard_pull") {
 *   // Discard changes and pull
 * }
 * ```
 */
import i18n from "@src/i18n";

import { openNativeChoiceDialog } from "../nativeChoiceDialog";

// ============================================
// Types
// ============================================

type PullConflictResult = "stash_pull" | "discard_pull" | "cancel";

interface PullConflictOptions {
  branchName?: string;
  remoteName?: string;
  conflictingFiles?: string[];
}

// ============================================
// Manager Class (Imperative API)
// ============================================

class PullConflictDialogManager {
  /**
   * Open the pull conflict dialog using native system dialog
   * @returns Promise that resolves with user's choice
   */
  public async open(
    options: PullConflictOptions = {}
  ): Promise<PullConflictResult> {
    const branch = options.branchName || "main";
    const fileCount = options.conflictingFiles?.length || 0;
    const fileInfo =
      fileCount > 0
        ? i18n.t("common:git.dialogs.pullConflict.fileInfo", {
            count: fileCount,
          })
        : "";

    return openNativeChoiceDialog({
      title: i18n.t("common:git.dialogs.pullConflict.title"),
      message: i18n.t("common:git.dialogs.pullConflict.body", {
        branch,
        fileInfo,
      }),
      choices: [
        {
          id: "stash_pull",
          label: i18n.t("common:git.dialogs.pullConflict.stashAndPull"),
        },
        {
          id: "discard_pull",
          label: i18n.t("common:git.dialogs.pullConflict.discardAndPull"),
        },
      ],
    });
  }
}

// Create singleton instance
export const PullConflictDialog = new PullConflictDialogManager();

export default PullConflictDialog;
