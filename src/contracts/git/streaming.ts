/**
 * Git streaming error vocabulary.
 *
 * Emitted by the backend over SSE (`api/http/git/streaming`) and named by
 * `types/workstation/gitOutputIntegration` and its consumers.
 */

/**
 * Git error types detected by the backend
 * These map to specific dialogs in the frontend
 */
export type GitErrorType =
  | "none"
  | "non_fast_forward" // Push rejected - remote has changes
  | "protected_branch" // Target branch is protected
  | "authentication_failed" // Auth failed
  | "remote_branch_deleted" // Remote branch was deleted
  | "uncommitted_changes" // Local changes would be overwritten
  | "network_error" // Network/connection error
  | "merge_conflicts" // Merge conflicts
  | "permission_denied" // Permission denied
  | "unknown"; // Unknown error
