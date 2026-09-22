/**
 * useBranchCheckout - Handles branch checkout with conflict resolution
 */
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { createLogger } from "@src/hooks/logger";
import { performBranchSwitch } from "@src/services/git/operations/performBranchSwitch";
import {
  REPO_KIND,
  currentBranchAtom,
  selectedRepoAtom,
  selectedRepoIdAtom,
} from "@src/store/repo";
import {
  activeWorkspaceRootPathAtom,
  activeWorktreeAtom,
} from "@src/store/workspace";

import {
  addCheckoutStateListener,
  isCheckingOut,
  notifyCheckoutState,
  setIsCheckingOut,
} from "./singleton";
import type { UseBranchCheckoutReturn } from "./types";

const log = createLogger("useBranchCheckout");

export function useBranchCheckout(): UseBranchCheckoutReturn {
  const selectedRepoId = useAtomValue(selectedRepoIdAtom);
  const [, setCurrentBranch] = useAtom(currentBranchAtom);
  const selectedRepo = useAtomValue(selectedRepoAtom);
  const activeWorktree = useAtomValue(activeWorktreeAtom);
  const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);

  const [checkoutLoading, setCheckoutLoading] = useState(isCheckingOut);

  // Subscribe to checkout state changes from any hook instance
  useEffect(() => {
    return addCheckoutStateListener((loading) => setCheckoutLoading(loading));
  }, []);

  const selectBranch = useCallback(
    async (branch: string) => {
      if (!selectedRepoId) {
        log.warn("[useBranchCheckout] Cannot checkout: no repo selected");
        return;
      }

      const repo = selectedRepo;
      const repoPath =
        activeWorktree?.repoId === selectedRepoId
          ? activeWorkspaceRootPath
          : repo?.path || repo?.fs_uri;

      if (!repoPath) {
        log.warn("[useBranchCheckout] Cannot checkout: no repo path");
        return;
      }

      // Plain work folders are not git repos — never call the checkout API.
      if (repo?.kind === REPO_KIND.FOLDER) {
        flushSync(() => {
          setCurrentBranch(branch);
        });
        return;
      }

      // Clearing branch state without git (e.g. after selecting a work folder).
      if (branch.trim() === "") {
        flushSync(() => {
          setCurrentBranch(branch);
        });
        return;
      }

      if (isCheckingOut) return;
      setIsCheckingOut(true);
      notifyCheckoutState(true);
      try {
        await performBranchSwitch({ repoId: selectedRepoId, repoPath }, branch);
      } finally {
        setIsCheckingOut(false);
        notifyCheckoutState(false);
      }
    },
    [
      selectedRepoId,
      selectedRepo,
      activeWorktree,
      activeWorkspaceRootPath,
      setCurrentBranch,
    ]
  );

  return {
    checkoutLoading,
    selectBranch,
  };
}
