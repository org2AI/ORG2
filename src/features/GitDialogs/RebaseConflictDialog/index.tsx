/**
 * RebaseConflictDialog
 *
 * Shown when git rebase encounters conflicts.
 * Offers options to resolve or abort the rebase.
 * Uses native Tauri system dialog.
 *
 * @example
 * ```tsx
 * import { RebaseConflictDialog } from "@src/features/GitDialogs";
 *
 * const result = await RebaseConflictDialog.open({
 *   targetBranch: "main",
 *   currentStep: 3,
 *   totalSteps: 5,
 *   conflictingFiles: ["src/index.ts"],
 * });
 *
 * if (result === "resolve") {
 *   // Open conflict resolution
 * } else if (result === "abort") {
 *   // Abort rebase
 * }
 * ```
 */
import i18n from "@src/i18n";

import { openNativeChoiceDialog } from "../nativeChoiceDialog";

// ============================================
// Types
// ============================================

type RebaseConflictResult = "resolve" | "abort" | "cancel";

interface RebaseConflictOptions {
  targetBranch?: string;
  currentStep?: number;
  totalSteps?: number;
  conflictingFiles?: string[];
  /** Type of operation that caused the conflict */
  operationType?: "rebase" | "merge";
}

// ============================================
// Manager Class (Imperative API)
// ============================================

class RebaseConflictDialogManager {
  /**
   * Open the rebase conflict dialog using native system dialog
   * @returns Promise that resolves with user's choice
   */
  public async open(
    options: RebaseConflictOptions = {}
  ): Promise<RebaseConflictResult> {
    const isMerge = (options.operationType || "rebase") === "merge";
    const hasProgress =
      options.currentStep !== undefined && options.totalSteps !== undefined;
    const progress = hasProgress
      ? i18n.t("common:git.dialogs.conflict.progress", {
          current: options.currentStep,
          total: options.totalSteps,
        })
      : "";
    const fileCount = options.conflictingFiles?.length || 0;
    const files =
      fileCount > 0
        ? i18n.t("common:git.dialogs.conflict.files", { count: fileCount })
        : "";

    return openNativeChoiceDialog({
      title: i18n.t(
        isMerge
          ? "common:git.dialogs.conflict.titleMerge"
          : "common:git.dialogs.conflict.titleRebase"
      ),
      message: i18n.t(
        isMerge
          ? "common:git.dialogs.conflict.bodyMerge"
          : "common:git.dialogs.conflict.bodyRebase",
        { branch: options.targetBranch || "main", progress, files }
      ),
      kind: "error",
      choices: [
        {
          id: "resolve",
          label: i18n.t("common:git.dialogs.conflict.resolve"),
        },
        {
          id: "abort",
          label: i18n.t(
            isMerge
              ? "common:git.dialogs.conflict.abortMerge"
              : "common:git.dialogs.conflict.abortRebase"
          ),
        },
      ],
    });
  }
}

// Create singleton instance
export const RebaseConflictDialog = new RebaseConflictDialogManager();

export default RebaseConflictDialog;
