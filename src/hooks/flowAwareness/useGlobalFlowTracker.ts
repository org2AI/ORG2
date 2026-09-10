/**
 * Global Flow Tracker Hook - automatically tracks common user activities.
 *
 * Mount this hook at the app root to enable automatic tracking of:
 * - File changes (via Tauri file watcher events)
 * - Git operations (via repo events from git watch)
 * - Lint diagnostics (via lint scan events)
 *
 * Note: Terminal commands and searches are tracked by the agent system,
 * not via events. The Rust backend directly records them.
 *
 * @example
 * ```tsx
 * // In App.tsx or a top-level component
 * function App() {
 *   useGlobalFlowTracker();
 *   return <Router>...</Router>;
 * }
 * ```
 */
import { useTauriListen } from "@src/hooks/platform/useTauriListen";

import { useFlowAwareness } from "./useFlowAwareness";

// ============================================
// Event Types (matching Rust emit payloads)
// ============================================

/** File change event from git watch (file:changed) */
interface FileChangedEvent {
  repo_id: string;
  path: string;
  kind: string; // "modified", "created", "deleted", "renamed"
}

/** Lint tool completed event (lint:tool_completed) */
interface LintToolCompletedEvent {
  tool: string;
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning" | "info" | "hint";
    rule?: string;
    source?: string;
  }>;
  files_scanned: number;
  error?: string;
}

/** Repo changed event (repo:changed) */
interface RepoChangedEvent {
  repo_id: string;
  change_type: "files" | "git_meta" | "branch" | "remote";
  affected_count: number;
}

export function useGlobalFlowTracker(): void {
  const { recordFileEdit, recordGitOperation, recordError } = useFlowAwareness({
    enabled: true,
  });

  useTauriListen<FileChangedEvent>("file:changed", ({ path, kind }) => {
    const editType =
      kind === "created"
        ? "create"
        : kind === "deleted"
          ? "delete"
          : kind === "renamed"
            ? "rename"
            : "modify";
    recordFileEdit(path, editType);
  });

  // Track branch changes as git operations
  useTauriListen<RepoChangedEvent>("repo:changed", ({ change_type }) => {
    if (change_type === "branch") {
      recordGitOperation("branch_switch");
    }
  });

  useTauriListen<LintToolCompletedEvent>(
    "lint:tool_completed",
    ({ diagnostics, error }) => {
      // Record tool-level errors
      if (error) {
        recordError("lint", error);
      }

      // Record individual lint errors (not warnings)
      for (const diag of diagnostics) {
        if (diag.severity === "error") {
          recordError("lint", diag.message, diag.file, diag.line);
        }
      }
    }
  );
}
