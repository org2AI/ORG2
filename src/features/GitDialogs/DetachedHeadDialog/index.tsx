/**
 * DetachedHeadDialog
 *
 * Shown when the repository is in detached HEAD state and the user
 * is about to do something that could lose commits.
 * Uses native Tauri system dialog.
 *
 * @example
 * ```tsx
 * import { DetachedHeadDialog } from "@src/features/GitDialogs";
 *
 * const result = await DetachedHeadDialog.open({
 *   commitHash: "a1b2c3d",
 * });
 *
 * if (result === "create_branch") {
 *   // Create a branch at the current commit
 * } else if (result === "continue") {
 *   // Continue without a branch
 * }
 * ```
 */
import i18n from "@src/i18n";

import { openNativeChoiceDialog } from "../nativeChoiceDialog";

// ============================================
// Types
// ============================================

type DetachedHeadResult = "create_branch" | "continue" | "cancel";

interface DetachedHeadOptions {
  commitHash?: string;
  suggestedBranchName?: string;
}

// ============================================
// Manager Class (Imperative API)
// ============================================

class DetachedHeadDialogManager {
  /**
   * Open the detached HEAD dialog using native system dialog
   * @returns Promise that resolves with user's choice
   */
  public async open(
    options: DetachedHeadOptions = {}
  ): Promise<DetachedHeadResult> {
    const shortHash = (options.commitHash || "HEAD").slice(0, 7);

    return openNativeChoiceDialog({
      title: i18n.t("common:git.dialogs.detachedHead.title"),
      message: i18n.t("common:git.dialogs.detachedHead.body", { shortHash }),
      choices: [
        {
          id: "create_branch",
          label: i18n.t("common:git.dialogs.detachedHead.createBranch"),
        },
        {
          id: "continue",
          label: i18n.t(
            "common:git.dialogs.detachedHead.continueWithoutBranch"
          ),
        },
      ],
    });
  }
}

// Create singleton instance
export const DetachedHeadDialog = new DetachedHeadDialogManager();

export default DetachedHeadDialog;
