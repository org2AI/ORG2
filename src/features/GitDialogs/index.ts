/**
 * Git Dialogs
 *
 * Collection of imperative dialogs for git operations.
 * Branch switching uses the shared in-app modal; other operations retain their existing dialogs.
 *
 * @example
 * ```tsx
 * import {
 *   PullConflictDialog,
 *   PushRejectedDialog,
 *   DetachedHeadDialog,
 *   ProtectedBranchDialog,
 *   LargePushConfirmDialog,
 *   RebaseConflictDialog,
 * } from "@src/features/GitDialogs";
 *
 * // All dialogs use the same imperative API pattern:
 * const result = await PushRejectedDialog.open({
 *   branchName: "main",
 *   behindCount: 3,
 * });
 * ```
 */

// ============================================
// Dialog Exports
// ============================================

export { PullConflictDialog } from "./PullConflictDialog";

export { PushRejectedDialog } from "./PushRejectedDialog";

export { DetachedHeadDialog } from "./DetachedHeadDialog";

export { ProtectedBranchDialog } from "./ProtectedBranchDialog";

export {
  LargePushConfirmDialog,
  LARGE_PUSH_THRESHOLD,
} from "./LargePushConfirmDialog";

export { RebaseConflictDialog } from "./RebaseConflictDialog";

export { createBranchSwitchDialog } from "./CheckoutConflictDialog";
