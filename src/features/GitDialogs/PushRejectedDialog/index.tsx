/**
 * PushRejectedDialog
 *
 * Shown when git push fails because remote has commits
 * that local doesn't have (non-fast-forward error).
 * Uses native Tauri system dialog.
 *
 * @example
 * ```tsx
 * import { PushRejectedDialog } from "@src/features/GitDialogs";
 *
 * const result = await PushRejectedDialog.open({
 *   branchName: "main",
 *   behindCount: 3,
 * });
 *
 * if (result === "pull_push") {
 *   // Pull then push
 * } else if (result === "force") {
 *   // Force push
 * }
 * ```
 */
import i18n from "@src/i18n";

import { openNativeChoiceDialog } from "../nativeChoiceDialog";

// ============================================
// Types
// ============================================

type PushRejectedResult = "pull_push" | "force" | "cancel";

interface PushRejectedOptions {
  branchName?: string;
  remoteName?: string;
  behindCount?: number;
}

// ============================================
// Manager Class (Imperative API)
// ============================================

class PushRejectedDialogManager {
  /**
   * Open the push rejected dialog using native system dialog
   * @returns Promise that resolves with user's choice
   */
  public async open(
    options: PushRejectedOptions = {}
  ): Promise<PushRejectedResult> {
    const branch = options.branchName || "current branch";
    const remote = options.remoteName || "origin";
    const behindInfo =
      options.behindCount && options.behindCount > 0
        ? i18n.t("common:git.dialogs.pushRejected.behindInfo", {
            count: options.behindCount,
          })
        : "";

    return openNativeChoiceDialog({
      title: i18n.t("common:git.dialogs.pushRejected.title"),
      message: i18n.t("common:git.dialogs.pushRejected.body", {
        remote,
        branch,
        behindInfo,
      }),
      choices: [
        {
          id: "pull_push",
          label: i18n.t("common:git.dialogs.pushRejected.pullAndPush"),
        },
        {
          id: "force",
          label: i18n.t("common:git.dialogs.pushRejected.forcePush"),
        },
      ],
    });
  }
}

// Create singleton instance
export const PushRejectedDialog = new PushRejectedDialogManager();

export default PushRejectedDialog;
