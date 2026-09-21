import type { SwitchScope } from "@src/api/http/git/branchSwitch";
import { getGitWorktrees } from "@src/api/http/git/worktrees";
import Message from "@src/components/Message";
import { branchSwitchQuestion } from "@src/features/GitDialogs/BranchSwitchQuestion";
import { createBranchSwitchDialog } from "@src/features/GitDialogs/CheckoutConflictDialog";
import i18n from "@src/i18n";
import { currentBranchAtom, selectedRepoIdAtom } from "@src/store/repo";
import {
  activeWorkspaceRootPathAtom,
  setActiveWorktreeAtom,
} from "@src/store/workspace";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { ensureSwitchWorkspaceReady } from "./branchSwitchWorkspace";
import { runGuardedCheckout } from "./guardedCheckout";

export async function performBranchSwitch(
  scope: SwitchScope,
  branch: string,
  create = false,
  startPoint?: string
) {
  const dialog = createBranchSwitchDialog(scope);
  const store = getInstrumentedStore();
  let published = false;
  const publish = (currentBranch?: string) => {
    if (
      currentBranch &&
      store.get(selectedRepoIdAtom) === scope.repoId &&
      (!scope.repoPath ||
        store.get(activeWorkspaceRootPathAtom) === scope.repoPath)
    )
      store.set(currentBranchAtom, currentBranch);
    published = true;
    window.dispatchEvent(
      new CustomEvent("orgii-branch-switch-completed", { detail: scope })
    );
  };
  const result = await runGuardedCheckout({
    ...scope,
    ref: branch,
    create,
    startPoint,
    beforePrepare: () =>
      ensureSwitchWorkspaceReady(scope, { confirmActiveTask: true }),
    beforeExecute: async () => {
      const ready = await ensureSwitchWorkspaceReady(scope);
      if (!ready) dialog.dispose();
      return ready;
    },
    onConflict: dialog.choose,
    onExecuting: dialog.executing,
    onComplete: async (result) => {
      publish(result.current_branch);
      await dialog.complete(result);
      if (result.outcome === "switched") {
        const switchedTo = i18n.t(
          "common:git.branchSwitch.switchedTo",
          "Switched to {{branch}}",
          { branch: result.current_branch }
        );
        Message.spotlight({
          ...(result.message
            ? { title: switchedTo, content: result.message }
            : { content: switchedTo }),
          variant: "success",
          duration: 2500,
        });
      }
    },
    onBlocked: async ({ message, worktreePath, currentBranch }) => {
      if (worktreePath) {
        dialog.dispose();
        const open = await branchSwitchQuestion(
          i18n.t(
            "common:git.branchSwitch.worktreeTitle",
            "Branch is open in another worktree"
          ),
          `${message}\n${worktreePath}`,
          i18n.t("common:git.branchSwitch.openWorktree", "Open worktree")
        );
        if (open) {
          const worktrees = await getGitWorktrees({
            repo_id: scope.repoId,
            repo_path: scope.repoPath,
          });
          const worktree = worktrees.find(
            (entry) => entry.path === worktreePath
          );
          if (!worktree)
            throw new Error(
              i18n.t(
                "common:git.branchSwitch.messages.worktree_missing",
                "The worktree no longer exists. Refresh and try again"
              )
            );
          store.set(setActiveWorktreeAtom, {
            repoId: scope.repoId,
            path: worktreePath,
            branch: worktree.branch,
            isMain: worktree.is_main,
          });
        }
      } else
        await dialog.blocked(
          message ||
            i18n.t(
              "common:git.branchSwitch.blockedTitle",
              "Branch switch needs attention"
            ),
          currentBranch
        );
    },
  });
  if (!published && result.currentBranch) publish(result.currentBranch);
  return result;
}
