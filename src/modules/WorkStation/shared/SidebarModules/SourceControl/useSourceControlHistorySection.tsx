/**
 * useSourceControlHistorySection
 *
 * Git History mode of the Source Control sidebar: the section filter, the
 * graph/list view toggle, the refresh button and the history list.
 */
import type { TFunction } from "i18next";
import React, { useCallback, useMemo, useRef, useState } from "react";

import AnyIcon from "@src/components/AnyIcon";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import {
  SectionFilterInput,
  makeSectionFilterAction,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionFilterInput";
import {
  ICON_CONFIG,
  PANEL_CONSTANTS,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config";
import { useSectionFilter } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/useSectionFilter";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";

import { AlternateModeFallback } from "./AlternateModeFallback";

const HistoryRefreshIcon = ICON_CONFIG.refresh;
const GitHistoryContent = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/GitHistoryContent")
);

interface UseSourceControlHistorySectionOptions {
  t: TFunction;
  repoPath: string;
  repoId: string;
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
}

export function useSourceControlHistorySection({
  t,
  repoPath,
  repoId,
  onGitHistorySelectionChange,
}: UseSourceControlHistorySectionOptions) {
  const historyRefreshRef = useRef<(() => void) | null>(null);
  const [historyViewMode, setHistoryViewMode] = useState<"graph" | "list">(
    "graph"
  );
  const {
    isOpen: showHistoryFilter,
    query: historyFilterQuery,
    setQuery: setHistoryFilterQuery,
    toggle: handleToggleHistoryFilter,
    clear: clearHistoryFilter,
  } = useSectionFilter();

  const handleHistoryRefreshReady = useCallback((refresh: () => void) => {
    historyRefreshRef.current = refresh;
  }, []);
  const handleHistoryRefresh = useCallback(() => {
    historyRefreshRef.current?.();
  }, []);

  const {
    spinClass: historyRefreshSpinClass,
    handleClick: handleHistoryRefreshClick,
  } = useRefreshSpin(handleHistoryRefresh, false);

  const historyActions = useMemo<SectionHeaderAction[]>(
    () => [
      makeSectionFilterAction({
        key: "history-filter",
        isOpen: showHistoryFilter,
        hasQuery: historyFilterQuery.length > 0,
        onToggle: handleToggleHistoryFilter,
        tooltip: t("common:actions.search"),
      }),
      {
        key: "history-view-mode",
        icon: (
          <AnyIcon
            icon={
              historyViewMode === "graph"
                ? ICON_CONFIG.list
                : ICON_CONFIG.listTree
            }
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
          />
        ),
        tooltip: t(
          historyViewMode === "graph"
            ? "common:workstation.switchToListView"
            : "common:workstation.switchToGraphView"
        ),
        onClick: () =>
          setHistoryViewMode((mode) => (mode === "graph" ? "list" : "graph")),
        forceVisible: true,
      },
      {
        key: "refresh-git-history",
        icon: (
          <AnyIcon
            icon={HistoryRefreshIcon}
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            className={historyRefreshSpinClass}
          />
        ),
        tooltip: "",
        onClick: handleHistoryRefreshClick,
      },
    ],
    [
      showHistoryFilter,
      historyFilterQuery,
      handleToggleHistoryFilter,
      handleHistoryRefreshClick,
      historyRefreshSpinClass,
      historyViewMode,
      t,
    ]
  );

  const historyContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col">
        {showHistoryFilter && (
          <SectionFilterInput
            query={historyFilterQuery}
            onChange={setHistoryFilterQuery}
            onClose={clearHistoryFilter}
          />
        )}
        <React.Suspense fallback={<AlternateModeFallback />}>
          <GitHistoryContent
            repoPath={repoPath}
            repoId={repoId}
            viewMode={historyViewMode}
            onRefreshReady={handleHistoryRefreshReady}
            onHistorySelectionChange={onGitHistorySelectionChange}
            filterQuery={historyFilterQuery}
          />
        </React.Suspense>
      </div>
    ),
    [
      showHistoryFilter,
      historyViewMode,
      historyFilterQuery,
      setHistoryFilterQuery,
      clearHistoryFilter,
      handleHistoryRefreshReady,
      onGitHistorySelectionChange,
      repoPath,
      repoId,
    ]
  );

  return { historyActions, historyContent };
}
