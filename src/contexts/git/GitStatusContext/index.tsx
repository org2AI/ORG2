/**
 * GitStatusContext - SINGLE SOURCE OF TRUTH
 *
 * Provides git status for the currently selected repo.
 *
 * Usage:
 * - Wrap app with <DeferredGitStatusProvider> (recommended) or <GitStatusProvider>
 * - Import useGitStatus() from ./useGitStatus to access git status and actions
 *
 * All other components must:
 * - Use useGitStatus() hook for already-scoped current repo status
 * - Call forceRefresh() after mutations (save, stage, commit)
 * - NEVER create their own event listeners
 */
export { DeferredGitStatusProvider } from "./DeferredGitStatusProvider";
