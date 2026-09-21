import { useAtomValue } from "jotai";
import { useEffect } from "react";

import {
  workstationAllClosedPrsAtomFamily,
  workstationAllOpenPrsAtomFamily,
  workstationClosedPrsErrorAtomFamily,
  workstationClosedPrsLoadStateAtomFamily,
  workstationOpenPrsErrorAtomFamily,
  workstationOpenPrsLoadStateAtomFamily,
  workstationPrAtomFamily,
  workstationPrCallbackAtomFamily,
  workstationRepoScopeKey,
} from "@src/store/workstation/codeEditor/workstationPrAtom";
import { retainWorkstationRepoScope } from "@src/store/workstation/codeEditor/workstationRepoScopeRetention";

/**
 * The repo-scoped PR atoms behind the sidebar list: the current branch's PR
 * snapshot, the open / closed lists with their load state, and the list
 * callbacks. Retains the scope while mounted and loads the open list.
 */
export function usePullRequestListData(
  repoId: string | null | undefined,
  repoPath: string | undefined
) {
  const scopeKey = workstationRepoScopeKey(repoId, repoPath);
  // Keep this repo's list atoms alive while the panel is mounted.
  useEffect(() => retainWorkstationRepoScope(scopeKey), [scopeKey]);
  const {
    prUrl,
    readyToCreate,
    isCreating: prCreating,
  } = useAtomValue(workstationPrAtomFamily(scopeKey));
  const {
    createPr: onCreatePr,
    loadOpenPrs,
    loadClosedPrs,
  } = useAtomValue(workstationPrCallbackAtomFamily(scopeKey));
  const allOpenPrs = useAtomValue(workstationAllOpenPrsAtomFamily(scopeKey));
  const allClosedPrs = useAtomValue(
    workstationAllClosedPrsAtomFamily(scopeKey)
  );
  const openPrsLoadState = useAtomValue(
    workstationOpenPrsLoadStateAtomFamily(scopeKey)
  );
  const openPrsError = useAtomValue(
    workstationOpenPrsErrorAtomFamily(scopeKey)
  );
  const closedPrsLoadState = useAtomValue(
    workstationClosedPrsLoadStateAtomFamily(scopeKey)
  );
  const closedPrsError = useAtomValue(
    workstationClosedPrsErrorAtomFamily(scopeKey)
  );

  useEffect(() => {
    loadOpenPrs?.();
  }, [loadOpenPrs]);

  return {
    prUrl,
    readyToCreate,
    prCreating,
    onCreatePr,
    loadClosedPrs,
    allOpenPrs,
    allClosedPrs,
    openPrsLoadState,
    openPrsError,
    closedPrsLoadState,
    closedPrsError,
  };
}
