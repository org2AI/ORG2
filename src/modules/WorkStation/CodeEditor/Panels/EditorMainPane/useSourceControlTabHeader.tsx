/**
 * useSourceControlTabHeader
 *
 * Wires the editor host's Source Control actions and publishes the Source
 * Control header strip into the global workstation tab-header slot while the
 * Source Control tab is active. Returns the actions the retained Source
 * Control main pane consumes, plus the header's focus-toolbar portal target.
 */
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useMemo, useState } from "react";

import { usePublishWorkstationTabHeader } from "@src/hooks/tabHost/useWorkstationTabHeader";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor";
import { workstationSelectedIssueAtomFamily } from "@src/store/workstation/codeEditor/workstationIssueAtom";
import { workstationRepoScopeKey } from "@src/store/workstation/codeEditor/workstationPrAtom";
import type { WorkStationTab } from "@src/store/workstation/tabs";

import { SourceControlHeaderContent } from "./components/SourceControlHeaderContent";
import {
  type UseSourceControlPaneActionsOptions,
  type UseSourceControlPaneActionsReturn,
  useSourceControlPaneActions,
} from "./hooks/useSourceControlPaneActions";

interface UseSourceControlTabHeaderOptions extends UseSourceControlPaneActionsOptions {
  activeTab: WorkStationTab | null;
  repoId?: string | null;
  repoPath: string;
  showSourceControlModePill: boolean;
  sourceControlHeaderLeadingSlot?: ReactNode;
  sourceControlHeaderTrailingSlot?: ReactNode;
}

export interface UseSourceControlTabHeaderReturn extends Pick<
  UseSourceControlPaneActionsReturn,
  | "sourceControlCollapseAllSignal"
  | "handleSourceControlCloseFocus"
  | "handleOpenSourceControlHistoryInNewTab"
  | "sourceControlQuickActions"
> {
  /** Header toolbar element the visible Source Control pane renders file actions into. */
  focusToolbarTarget: HTMLSpanElement | null;
}

export function useSourceControlTabHeader({
  t,
  activeTab,
  repoId,
  repoPath,
  updatePaneState,
  forceRefresh,
  gitDiffLoading,
  sourceControlFilterMode,
  showSourceControlModePill,
  sourceControlHeaderLeadingSlot,
  sourceControlHeaderTrailingSlot,
}: UseSourceControlTabHeaderOptions): UseSourceControlTabHeaderReturn {
  const scopeKey = workstationRepoScopeKey(repoId, repoPath);
  const selectedIssueState = useAtomValue(
    workstationSelectedIssueAtomFamily(scopeKey)
  );
  const [diffViewMode, setDiffViewMode] = useAtom(diffViewModeAtom);

  const {
    sourceControlRefreshSpinClass,
    handleSourceControlRefresh,
    sourceControlCollapseAllSignal,
    handleSourceControlModeChange,
    handleSourceControlCollapseAll,
    handleSourceControlCloseFocus,
    gitReviewNavigation,
    handleReviewPrevFile,
    handleReviewNextFile,
    handleOpenSourceControlHistoryInNewTab,
    sourceControlQuickActions,
  } = useSourceControlPaneActions({
    t,
    updatePaneState,
    forceRefresh,
    gitDiffLoading,
    sourceControlFilterMode,
  });

  const [focusToolbarTarget, setFocusToolbarTarget] =
    useState<HTMLSpanElement | null>(null);

  // Memoized so `usePublishWorkstationTabHeader` sees a stable `content`
  // identity — a fresh element every render would re-publish the global
  // header slot on each pass.
  const sourceControlHeaderContent = useMemo(() => {
    if (activeTab?.type !== "source-control") return null;
    return (
      <SourceControlHeaderContent
        activeTab={activeTab}
        focusToolbarRef={setFocusToolbarTarget}
        sourceControlFilterMode={sourceControlFilterMode}
        showSourceControlModePill={showSourceControlModePill}
        gitReviewNavigationTotal={gitReviewNavigation.total}
        selectedIssue={selectedIssueState.issue}
        sourceControlHeaderLeadingSlot={sourceControlHeaderLeadingSlot}
        sourceControlHeaderTrailingSlot={sourceControlHeaderTrailingSlot}
        sourceControlRefreshSpinClass={sourceControlRefreshSpinClass}
        diffViewMode={diffViewMode}
        t={t}
        onDiffViewModeChange={setDiffViewMode}
        onModeChange={handleSourceControlModeChange}
        onReviewPrevFile={handleReviewPrevFile}
        onReviewNextFile={handleReviewNextFile}
        onCollapseAll={handleSourceControlCollapseAll}
        onRefresh={handleSourceControlRefresh}
      />
    );
  }, [
    activeTab,
    diffViewMode,
    gitReviewNavigation.total,
    handleReviewNextFile,
    handleReviewPrevFile,
    handleSourceControlCollapseAll,
    handleSourceControlModeChange,
    handleSourceControlRefresh,
    selectedIssueState,
    showSourceControlModePill,
    sourceControlFilterMode,
    sourceControlHeaderLeadingSlot,
    sourceControlHeaderTrailingSlot,
    sourceControlRefreshSpinClass,
    setDiffViewMode,
    t,
  ]);

  usePublishWorkstationTabHeader({
    host: "code",
    content: sourceControlHeaderContent,
    enabled: activeTab?.type === "source-control",
  });

  return {
    sourceControlCollapseAllSignal,
    handleSourceControlCloseFocus,
    handleOpenSourceControlHistoryInNewTab,
    sourceControlQuickActions,
    focusToolbarTarget,
  };
}
