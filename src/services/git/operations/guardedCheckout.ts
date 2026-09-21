/** One checkout coordinator for hook, picker and ActionSystem entry points. */
import type { CheckoutErrorType } from "@src/api/http/git/branchOps";
import {
  type BranchSwitchResult,
  type SwitchPreparation,
  type SwitchStrategy,
  branchSwitchApi,
} from "@src/api/http/git/branchSwitch";

import { localizeBranchSwitchMessage } from "./branchSwitchMessages";

export type CheckoutBlockedErrorType = Exclude<
  CheckoutErrorType,
  "uncommitted_changes"
>;
export interface GuardedCheckoutResult {
  success: boolean;
  outcome:
    | "checked-out"
    | "stashed"
    | "brought"
    | "conflicts"
    | "cancelled"
    | "error";
  errorType: CheckoutErrorType | "none";
  message?: string;
  currentBranch?: string;
  blocked?: boolean;
}
export interface GuardedCheckoutParams {
  repoId: string;
  repoPath?: string;
  ref: string;
  create?: boolean;
  startPoint?: string;
  beforePrepare?: () => Promise<boolean>;
  beforeExecute?: () => Promise<boolean>;
  onConflict: (
    preparation: SwitchPreparation
  ) => Promise<SwitchStrategy | "cancel">;
  onExecuting?: () => void;
  onComplete?: (result: BranchSwitchResult) => Promise<void>;
  onBlocked?: (options: {
    branch: string;
    errorType: CheckoutBlockedErrorType | "none";
    message?: string;
    worktreePath?: string;
    currentBranch?: string;
  }) => Promise<void>;
}

// No retained results or background timers. Remove every key at terminal state.
const inFlight = new Set<string>();
export async function runGuardedCheckout(
  params: GuardedCheckoutParams
): Promise<GuardedCheckoutResult> {
  const scope = { repoId: params.repoId, repoPath: params.repoPath };
  const key = params.repoPath || params.repoId;
  if (inFlight.has(key))
    return { success: false, outcome: "cancelled", errorType: "none" };
  inFlight.add(key);
  const target = {
    branch: params.ref,
    create: params.create,
    start_point: params.startPoint,
  };
  let currentBranch: string | undefined;
  try {
    if (params.beforePrepare && !(await params.beforePrepare()))
      return { success: false, outcome: "cancelled", errorType: "none" };
    const prepared = await branchSwitchApi.prepare(scope, target);
    currentBranch = prepared.current_branch;
    if (prepared.blocked)
      prepared.blocked.message = localizeBranchSwitchMessage(prepared.blocked);
    if (prepared.same_branch)
      return {
        success: true,
        outcome: "checked-out",
        errorType: "none",
        currentBranch,
      };
    if (prepared.blocked) {
      await params.onBlocked?.({
        branch: params.ref,
        currentBranch,
        errorType:
          prepared.blocked.code === "worktree_branch_in_use"
            ? "worktree_branch_in_use"
            : "other",
        message: prepared.blocked.message,
        worktreePath: prepared.blocked.worktree_path ?? undefined,
      });
      return {
        success: false,
        outcome: "error",
        errorType: "other",
        message: prepared.blocked.message,
        blocked: Boolean(params.onBlocked),
        currentBranch,
      };
    }
    const strategy = prepared.changed_files.length
      ? await params.onConflict(prepared)
      : prepared.default_strategy;
    if (strategy === "cancel")
      return {
        success: false,
        outcome: "cancelled",
        errorType: "none",
        currentBranch,
      };
    if (params.beforeExecute && !(await params.beforeExecute()))
      return {
        success: false,
        outcome: "cancelled",
        errorType: "none",
        currentBranch,
      };
    if (prepared.changed_files.length) params.onExecuting?.();
    const result = await branchSwitchApi.execute(
      scope,
      target,
      prepared.fingerprint,
      strategy
    );
    result.message = localizeBranchSwitchMessage(result, result.current_branch);
    currentBranch = result.current_branch;
    await params.onComplete?.(result);
    const switched =
      result.outcome === "switched" ||
      result.outcome === "switched_with_conflicts";
    return {
      success: switched,
      currentBranch,
      errorType: switched ? "none" : "other",
      message: result.message,
      blocked: Boolean(params.onComplete),
      outcome:
        result.outcome === "switched_with_conflicts"
          ? "conflicts"
          : !switched
            ? "error"
            : prepared.changed_files.length
              ? strategy === "leave"
                ? "stashed"
                : "brought"
              : "checked-out",
    };
  } catch (error) {
    // An interrupted HTTP response is not proof checkout failed. Re-read HEAD.
    try {
      currentBranch = (await branchSwitchApi.prepare(scope, target))
        .current_branch;
    } catch {
      currentBranch = undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    try {
      await params.onBlocked?.({
        branch: params.ref,
        currentBranch,
        errorType: "other",
        message,
      });
    } catch {
      // The normalized result still reaches callers if presenting the error fails.
    }
    return {
      success: false,
      outcome: "error",
      errorType: "other",
      message,
      currentBranch,
      blocked: Boolean(params.onBlocked),
    };
  } finally {
    inFlight.delete(key);
  }
}
