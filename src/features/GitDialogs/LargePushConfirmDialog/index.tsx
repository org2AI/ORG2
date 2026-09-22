/**
 * LargePushConfirmDialog
 *
 * Shown when user is about to push a large number of commits.
 * Asks for confirmation to prevent accidental large pushes.
 * Uses native Tauri system dialog.
 *
 * @example
 * ```tsx
 * import { LargePushConfirmDialog } from "@src/features/GitDialogs";
 *
 * const result = await LargePushConfirmDialog.open({
 *   commitCount: 25,
 *   branchName: "feature/big-change",
 * });
 *
 * if (result === "push") {
 *   // Proceed with push
 * }
 * ```
 */
import i18n from "@src/i18n";

import { openNativeChoiceDialog } from "../nativeChoiceDialog";

// ============================================
// Constants
// ============================================

/** Threshold for showing this dialog */
export const LARGE_PUSH_THRESHOLD = 10;

// ============================================
// Types
// ============================================

type LargePushResult = "push" | "cancel";

interface LargePushOptions {
  commitCount: number;
  branchName?: string;
  remoteName?: string;
}

// ============================================
// Manager Class (Imperative API)
// ============================================

class LargePushConfirmDialogManager {
  /**
   * Open the large push confirm dialog using native system dialog
   * @returns Promise that resolves with user's choice
   */
  public async open(options: LargePushOptions): Promise<LargePushResult> {
    const {
      commitCount,
      branchName = "current branch",
      remoteName = "origin",
    } = options;

    return openNativeChoiceDialog({
      title: i18n.t("common:git.dialogs.largePush.title"),
      message: i18n.t("common:git.dialogs.largePush.body", {
        commitCount,
        remote: remoteName,
        branch: branchName,
      }),
      choices: [
        {
          id: "push",
          label: i18n.t("common:git.dialogs.largePush.confirm"),
        },
      ],
    });
  }
}

// Create singleton instance
export const LargePushConfirmDialog = new LargePushConfirmDialogManager();

export default LargePushConfirmDialog;
