/**
 * useSourceControlSidebarModule
 *
 * Self-contained Source Control sidebar tab. Owns its own filter state,
 * view-mode toggle, action button list, inner refs, and filter-mode dropdown
 * header (Uncommitted / Unstaged / Staged / Stashed / Git History).
 * Any sidebar (Code Editor, Control Tower peek, future tab-specific
 * sidebars) can mount it with just `repoPath` + `repoId`.
 *
 * Returns a `PrimarySidebarTab` ready to be passed to
 * `PrimarySidebarLayoutWithSections`.
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GitWorktreeEntry } from "@src/api/http/git/types";
import Button from "@src/components/Button";
import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { useGitStatus } from "@src/contexts/git/GitStatusContext/useGitStatus";
import { sessionIdAtom } from "@src/engines/SessionCore";
import { useFileReviewBatchActions } from "@src/hooks/fileReview";
import { useMountedCleanup } from "@src/hooks/lifecycle/useMounted";
import { ArrowLeft02Icon, HugeiconsIcon, RotateLeft01Icon } from "@src/icons";
import { PANEL_CONSTANTS } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config";
import { StashHeaderContext } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/StashContent/StashHeaderContext";
import { useSourceControlActions } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks";
import {
  type SourceControlTabHandle,
  useSourceControlTabConfig,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/tabs/SourceControlTab";
import type { PrimarySidebarTab } from "@src/modules/WorkStation/shared/PrimarySidebarLayout";
import { workstationRepoScopeKey } from "@src/store/workstation/codeEditor/workstationPrAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import type { SourceControlFilterMode } from "./SourceControlFilterHeader";
import { useSourceControlHistorySection } from "./useSourceControlHistorySection";
import { useSourceControlIssuesSection } from "./useSourceControlIssuesSection";
import { useSourceControlPrSection } from "./useSourceControlPrSection";

export interface UseSourceControlSidebarModuleOptions {
  repoPath: string;
  repoId: string;
  /** Current branch name, forwarded to PullRequestContent for display. */
  branchName?: string;
  /** Optional callback when a git file is clicked — opens diff tab in caller. */
  onGitFileSelect?: (file: GitFile) => void;
  /** Optional callback when a history node is selected for inline display. */
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
  /**
   * Optional callback when the sidebar's current git file list changes.
   * `scopeRepoRoot` identifies which pane reported the update (host repo or
   * a worktree path) so the consumer can scope a bulk replace.
   */
  onGitFilesChange?: (files: GitFile[], scopeRepoRoot?: string) => void;
  /** Multi-root workspace? (changes header layout to per-folder collapse rows.) */
  isMultiRoot?: boolean;
  /** Shared filter mode owned by the host header. */
  filterMode?: SourceControlFilterMode;
  onFilterModeChange?: (mode: SourceControlFilterMode) => void;
  /** Notify parent on row click without updating sidebar selection. */
  navigateWithoutSelecting?: boolean;
  /** Optional worktree list supplied by the host to avoid duplicate fetches. */
  worktrees?: GitWorktreeEntry[];
  hasWorktrees?: boolean;
  worktreesLoading?: boolean;
  refreshWorktrees?: () => Promise<void>;
}

export interface UseSourceControlSidebarModuleResult {
  /** Drop-in `PrimarySidebarTab` config (key, label, icon, sections). */
  tab: PrimarySidebarTab;
  /** Imperative handle for `refresh()` from outside (status-bar Sync button etc.). */
  ref: React.RefObject<SourceControlTabHandle | null>;
}

export function useSourceControlSidebarModule({
  repoPath,
  repoId,
  branchName,
  onGitFileSelect,
  onGitHistorySelectionChange,
  onGitFilesChange,
  isMultiRoot = false,
  filterMode: controlledFilterMode,
  onFilterModeChange,
  navigateWithoutSelecting = false,
  worktrees: hostWorktrees,
  hasWorktrees: hostHasWorktrees,
  worktreesLoading: hostWorktreesLoading,
  refreshWorktrees: hostRefreshWorktrees,
}: UseSourceControlSidebarModuleOptions): UseSourceControlSidebarModuleResult {
  const { t } = useTranslation();
  const sourceControlRef = useRef<SourceControlTabHandle>(null);
  const mountedRef = useRef(true);
  useMountedCleanup(mountedRef);

  const [showFilter, setShowFilter] = useState(false);
  const [viewMode, setViewMode] = useState<"list-tree" | "list">("list-tree");
  const filterMode = controlledFilterMode ?? "uncommitted";
  const isHistoryMode = filterMode === "history";
  const isPrMode = filterMode === "pr";
  const isIssuesMode = filterMode === "issues";
  // Narrow the working-tree section filter (drop stashed/history — those
  // are routed via showOnlyStashes / sourceControlContentOverride).
  const sectionFilter: "uncommitted" | "staged" | "unstaged" =
    filterMode === "staged" || filterMode === "unstaged"
      ? filterMode
      : "uncommitted";

  const handleToggleFilter = useCallback(() => {
    setShowFilter((prev) => !prev);
  }, []);

  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "list-tree" ? "list" : "list-tree"));
  }, []);

  const sourceControlActions = useSourceControlActions({
    showFilter,
    viewMode,
    onToggleFilter: handleToggleFilter,
    onToggleViewMode: handleToggleViewMode,
  });

  const { historyActions, historyContent } = useSourceControlHistorySection({
    t,
    repoPath,
    repoId,
    onGitHistorySelectionChange,
  });

  const globalSessionId = useAtomValue(sessionIdAtom);
  const { pendingCount, onUndoAll } =
    useFileReviewBatchActions(globalSessionId);
  const { forceRefresh: refreshGitStatus } = useGitStatus();
  const [isUndoingAll, setIsUndoingAll] = useState(false);

  const handleUndoAll = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: t("common:actions.undoAll"),
      message: t("common:confirmation.undoAllChanges", {
        count: pendingCount,
      }),
      okLabel: t("common:actions.undoAll"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;
    setIsUndoingAll(true);
    try {
      await onUndoAll();
      refreshGitStatus().catch(() => {});
    } finally {
      if (mountedRef.current) setIsUndoingAll(false);
    }
  }, [t, pendingCount, onUndoAll, refreshGitStatus]);

  const undoAllAction = useMemo<SectionHeaderAction>(
    () => ({
      key: "undo-all-changes",
      icon: (
        <HugeiconsIcon
          icon={RotateLeft01Icon}
          data-icon="rotate-ccw"
          size={HEADER_ICON_SIZE.discard}
          strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
        />
      ),
      tooltip: t("common:actions.undoAll"),
      onClick: handleUndoAll,
      forceVisible: true,
    }),
    [handleUndoAll, t]
  );

  const sourceControlActionsWithUndo = useMemo<SectionHeaderAction[]>(
    () =>
      pendingCount > 0 && !isUndoingAll
        ? [undoAllAction, ...sourceControlActions]
        : sourceControlActions,
    [pendingCount, isUndoingAll, undoAllAction, sourceControlActions]
  );

  const scopeKey = workstationRepoScopeKey(repoId, repoPath);
  const { issueActions, issuesContent } = useSourceControlIssuesSection({
    t,
    repoPath,
    repoId,
    branchName,
    scopeKey,
  });

  const { prActions, prContent } = useSourceControlPrSection({
    t,
    repoPath,
    repoId,
    branchName,
    scopeKey,
    onGitHistorySelectionChange,
  });

  const actions = isHistoryMode
    ? historyActions
    : isPrMode
      ? prActions
      : isIssuesMode
        ? issueActions
        : sourceControlActionsWithUndo;
  const sectionLabel = isHistoryMode
    ? t("common:labels.gitHistory")
    : isPrMode
      ? t("common:labels.pullRequest")
      : isIssuesMode
        ? t("common:git.issues.title")
        : t("tabs.sourceControl");
  const isAlternateMode = isPrMode || isHistoryMode || isIssuesMode;
  const sectionTitle = isAlternateMode ? (
    <Button
      layout="custom"
      className="flex min-w-0 items-center gap-1.5 normal-case"
      onClick={() => onFilterModeChange?.("uncommitted")}
      aria-label={t("tabs.sourceControl")}
      title={t("tabs.sourceControl")}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <HugeiconsIcon
          icon={ArrowLeft02Icon}
          data-icon="arrow-left"
          size={14}
          className="text-text-3"
        />
      </span>
      <span className="truncate uppercase">{sectionLabel}</span>
    </Button>
  ) : (
    sectionLabel
  );

  const tab = useSourceControlTabConfig({
    repoPath,
    repoId,
    branchName,
    onGitFileSelect,
    onGitFilesChange,
    onGitHistorySelectionChange,
    showFilter,
    viewMode,
    sourceControlRef,
    actions,
    isMultiRoot,
    showOnlyStashes: filterMode === "stashed",
    sectionFilter,
    navigateWithoutSelecting,
    worktrees: hostWorktrees,
    hasWorktrees: hostHasWorktrees,
    worktreesLoading: hostWorktreesLoading,
    refreshWorktrees: hostRefreshWorktrees,
    sourceControlTitleOverride: isAlternateMode ? sectionTitle : undefined,
    sourceControlCollapsible: !isAlternateMode,
    sourceControlContentOverride: isPrMode
      ? prContent
      : isHistoryMode
        ? historyContent
        : isIssuesMode
          ? issuesContent
          : undefined,
  });

  const stashHeader = useMemo(
    () => ({
      onBack: () => onFilterModeChange?.("uncommitted"),
      actions: actions.map((action) => ({ ...action, forceVisible: true })),
    }),
    [actions, onFilterModeChange]
  );

  return useMemo(
    () => ({
      tab:
        filterMode === "stashed"
          ? {
              ...tab,
              sections: undefined,
              rawContent: (
                <StashHeaderContext.Provider value={stashHeader}>
                  {tab.sections?.[0]?.content}
                </StashHeaderContext.Provider>
              ),
            }
          : tab,
      ref: sourceControlRef,
    }),
    [tab, filterMode, stashHeader]
  );
}
