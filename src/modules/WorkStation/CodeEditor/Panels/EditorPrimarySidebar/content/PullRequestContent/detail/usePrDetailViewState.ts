import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

interface UsePrDetailViewStateOptions {
  repoId?: string;
  repoPath: string;
  prNumber: number;
}

/**
 * The scoped selected-PR state plus setters for the view state it retains
 * across remounts: conversation draft, selected commit and changed file.
 */
export function usePrDetailViewState({
  repoId,
  repoPath,
  prNumber,
}: UsePrDetailViewStateOptions) {
  const scopeKey = workstationPrScopeKey(repoId, repoPath, prNumber);
  const [state, setState] = useAtom(workstationSelectedPrAtomFamily(scopeKey));
  const detailViewState = state.viewState;
  const setDetailViewState = useCallback(
    (
      update: (current: typeof detailViewState) => typeof detailViewState
    ): void => {
      setState((current) => ({
        ...current,
        viewState: update(current.viewState),
      }));
    },
    [setState]
  );
  const activeTab = detailViewState.activeTab;
  const setConversationDraft = useCallback(
    (conversationDraft: string) => {
      setDetailViewState((current) => ({
        ...current,
        conversationDraft,
      }));
    },
    [setDetailViewState]
  );
  const setSelectedCommitSha = useCallback(
    (selectedCommitSha: string | null) => {
      setDetailViewState((current) => ({
        ...current,
        selectedCommitSha,
      }));
    },
    [setDetailViewState]
  );
  const setSelectedChangedFilePath = useCallback(
    (selectedChangedFilePath: string | null) => {
      setDetailViewState((current) => ({
        ...current,
        selectedChangedFilePath,
      }));
    },
    [setDetailViewState]
  );

  return {
    state,
    detailViewState,
    activeTab,
    setConversationDraft,
    setSelectedCommitSha,
    setSelectedChangedFilePath,
  };
}
