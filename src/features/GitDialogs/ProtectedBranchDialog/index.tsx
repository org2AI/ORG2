/**
 * ProtectedBranchDialog
 *
 * Shown when git push fails because the target branch is protected.
 * Suggests creating a pull request instead.
 * Uses native Tauri system dialog.
 *
 * @example
 * ```tsx
 * import { ProtectedBranchDialog } from "@src/features/GitDialogs";
 *
 * const result = await ProtectedBranchDialog.open({
 *   branchName: "main",
 * });
 *
 * if (result === "create_pr") {
 *   // Open PR creation flow
 * }
 * ```
 */
import i18n from "@src/i18n";

import { openNativeChoiceDialog } from "../nativeChoiceDialog";

// ============================================
// Types
// ============================================

type ProtectedBranchResult = "create_pr" | "cancel";

interface ProtectedBranchOptions {
  branchName?: string;
  remoteName?: string;
}

// ============================================
// Manager Class (Imperative API)
// ============================================

class ProtectedBranchDialogManager {
  /**
   * Open the protected branch dialog using native system dialog
   * @returns Promise that resolves with user's choice
   */
  public async open(
    options: ProtectedBranchOptions = {}
  ): Promise<ProtectedBranchResult> {
    return openNativeChoiceDialog({
      title: i18n.t("common:git.dialogs.protectedBranch.title"),
      message: i18n.t("common:git.dialogs.protectedBranch.body", {
        branch: options.branchName || "main",
        remote: options.remoteName || "origin",
      }),
      choices: [
        {
          id: "create_pr",
          label: i18n.t("common:git.dialogs.protectedBranch.createPr"),
        },
      ],
    });
  }
}

// Create singleton instance
export const ProtectedBranchDialog = new ProtectedBranchDialogManager();

export default ProtectedBranchDialog;
