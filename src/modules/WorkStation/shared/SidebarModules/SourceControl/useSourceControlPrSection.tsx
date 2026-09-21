/**
 * useSourceControlPrSection
 *
 * Pull request mode of the Source Control sidebar: the section filter, the
 * refresh button and the pull request list.
 */
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import React, { useCallback, useMemo } from "react";

import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { HugeiconsIcon, Refresh04Icon } from "@src/icons";
import {
  SectionFilterInput,
  makeSectionFilterAction,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionFilterInput";
import { PANEL_CONSTANTS } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config";
import { useSectionFilter } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/useSectionFilter";
import { workstationPrCallbackAtomFamily } from "@src/store/workstation/codeEditor/workstationPrAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";

import { AlternateModeFallback } from "./AlternateModeFallback";

const PullRequestContent = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent")
);

interface UseSourceControlPrSectionOptions {
  t: TFunction;
  repoPath: string;
  repoId: string;
  branchName?: string;
  /** `workstationRepoScopeKey(repoId, repoPath)` */
  scopeKey: string;
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
}

export function useSourceControlPrSection({
  t,
  repoPath,
  repoId,
  branchName,
  scopeKey,
  onGitHistorySelectionChange,
}: UseSourceControlPrSectionOptions) {
  const {
    isOpen: showPrFilter,
    query: prFilterQuery,
    setQuery: setPrFilterQuery,
    toggle: handleTogglePrFilter,
    clear: clearPrFilter,
  } = useSectionFilter();

  const prCallbacks = useAtomValue(workstationPrCallbackAtomFamily(scopeKey));
  const handlePrRefresh = useCallback(() => {
    prCallbacks.refreshPrs?.();
  }, [prCallbacks]);
  const { spinClass: prRefreshSpinClass, handleClick: handlePrRefreshClick } =
    useRefreshSpin(handlePrRefresh, false);
  const prActions = useMemo<SectionHeaderAction[]>(
    () => [
      makeSectionFilterAction({
        key: "pr-filter",
        isOpen: showPrFilter,
        hasQuery: prFilterQuery.length > 0,
        onToggle: handleTogglePrFilter,
        tooltip: t("common:actions.search"),
      }),
      {
        key: "refresh-prs",
        icon: (
          <HugeiconsIcon
            icon={Refresh04Icon}
            data-icon="refresh-cw"
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            className={prRefreshSpinClass}
          />
        ),
        tooltip: t("common:actions.refresh", "Refresh"),
        onClick: handlePrRefreshClick,
      },
    ],
    [
      showPrFilter,
      prFilterQuery,
      handleTogglePrFilter,
      handlePrRefreshClick,
      prRefreshSpinClass,
      t,
    ]
  );

  const prContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col">
        {showPrFilter && (
          <SectionFilterInput
            query={prFilterQuery}
            onChange={setPrFilterQuery}
            onClose={clearPrFilter}
          />
        )}
        <React.Suspense fallback={<AlternateModeFallback />}>
          <PullRequestContent
            branchName={branchName}
            filterQuery={prFilterQuery}
            onHistorySelectionChange={onGitHistorySelectionChange}
            repoId={repoId}
            repoPath={repoPath}
          />
        </React.Suspense>
      </div>
    ),
    [
      showPrFilter,
      prFilterQuery,
      setPrFilterQuery,
      clearPrFilter,
      branchName,
      onGitHistorySelectionChange,
      repoId,
      repoPath,
    ]
  );

  return { prActions, prContent };
}
