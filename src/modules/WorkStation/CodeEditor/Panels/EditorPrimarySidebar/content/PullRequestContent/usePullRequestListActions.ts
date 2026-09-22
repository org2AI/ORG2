import { useCallback, useState } from "react";

import type { OpenPRItem } from "@src/api/tauri/github";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";

interface UsePullRequestListActionsOptions {
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
  onCreatePr: (() => Promise<{ url?: string; error?: string }>) | null;
  prCreating: boolean;
}

/**
 * Row selection (published as a PR history selection) and creating a pull
 * request for the current branch, with its local error.
 */
export function usePullRequestListActions({
  onHistorySelectionChange,
  onCreatePr,
  prCreating,
}: UsePullRequestListActionsOptions) {
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);

  const handlePrClick = useCallback(
    (pr: OpenPRItem) => {
      setSelectedPrNumber(pr.number);
      const statusKey = pr.draft ? "draft" : pr.state;
      onHistorySelectionChange?.({
        type: "pr",
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.url,
        prStatus: statusKey,
        headBranch: pr.head_branch,
      });
    },
    [onHistorySelectionChange]
  );

  const handleCreate = useCallback(async () => {
    if (!onCreatePr || prCreating) return;
    setLocalCreateError(null);
    try {
      const result = await onCreatePr();
      if (result.error && result.error !== "not_authenticated") {
        setLocalCreateError(result.error);
      }
    } catch (err) {
      setLocalCreateError(err instanceof Error ? err.message : String(err));
    }
  }, [onCreatePr, prCreating]);

  return { selectedPrNumber, localCreateError, handlePrClick, handleCreate };
}
