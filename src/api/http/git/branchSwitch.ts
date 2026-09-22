import { fetchRustApi, gitRepoUrl } from "./client";

export interface SwitchScope {
  repoId: string;
  repoPath?: string;
}
export type SwitchStrategy = "leave" | "bring";
export interface SwitchTarget {
  branch: string;
  create?: boolean;
  start_point?: string;
}
export interface SwitchPreparation {
  current_branch: string;
  target_branch: string;
  fingerprint: string;
  changed_files: string[];
  default_strategy: SwitchStrategy;
  same_branch: boolean;
  blocked: {
    /** Stable localization key; `message` is the English fallback. */
    code: string;
    message: string;
    detail?: string | null;
    worktree_path: string | null;
  } | null;
}
export interface BranchSwitchResult {
  outcome:
    | "switched"
    | "switched_with_conflicts"
    | "blocked"
    | "recovery_required";
  current_branch: string;
  /** Stable localization key, empty for a plain switch. */
  code?: string;
  message: string;
  detail?: string | null;
  snapshot_id: string | null;
  conflicts: string[];
}
async function request<T>(
  scope: SwitchScope,
  operation: string,
  body: unknown
): Promise<T> {
  const query = new URLSearchParams();
  if (scope.repoPath) query.set("path", scope.repoPath);
  const url = `${gitRepoUrl(scope.repoId)}/branch-switch/${operation}?${query}`;
  return (
    await fetchRustApi<T>(url, { method: "POST", body: JSON.stringify(body) })
  ).data;
}
export const branchSwitchApi = {
  prepare: (scope: SwitchScope, target: SwitchTarget) =>
    request<SwitchPreparation>(scope, "prepare", target),
  execute: (
    scope: SwitchScope,
    target: SwitchTarget,
    fingerprint: string,
    strategy: SwitchStrategy
  ) =>
    request<BranchSwitchResult>(scope, "execute", {
      target,
      fingerprint,
      strategy,
    }),
};
