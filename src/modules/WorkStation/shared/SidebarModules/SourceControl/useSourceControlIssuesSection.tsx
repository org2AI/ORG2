/**
 * useSourceControlIssuesSection
 *
 * Issues mode of the Source Control sidebar: the section filter, the refresh
 * and new-issue buttons and the issue list.
 */
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import React, { useCallback, useMemo } from "react";

import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { CircleDotIcon, HugeiconsIcon, Refresh04Icon } from "@src/icons";
import { makeSectionFilterAction } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionFilterInput";
import { PANEL_CONSTANTS } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config";
import { useSectionFilter } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/useSectionFilter";
import { workstationIssueCallbackAtomFamily } from "@src/store/workstation/codeEditor/workstationIssueAtom";

import { AlternateModeFallback } from "./AlternateModeFallback";

const IssuesContent = React.lazy(
  () =>
    import("@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent")
);

interface UseSourceControlIssuesSectionOptions {
  t: TFunction;
  repoPath: string;
  repoId: string;
  branchName?: string;
  /** `workstationRepoScopeKey(repoId, repoPath)` */
  scopeKey: string;
}

export function useSourceControlIssuesSection({
  t,
  repoPath,
  repoId,
  branchName,
  scopeKey,
}: UseSourceControlIssuesSectionOptions) {
  const {
    isOpen: showIssuesFilter,
    query: issuesFilterQuery,
    setQuery: setIssuesFilterQuery,
    toggle: handleToggleIssuesFilter,
    clear: clearIssuesFilter,
  } = useSectionFilter();

  const issueCallbacks = useAtomValue(
    workstationIssueCallbackAtomFamily(scopeKey)
  );
  const handleIssuesRefresh = useCallback(() => {
    issueCallbacks.refreshIssues?.();
  }, [issueCallbacks]);
  const {
    spinClass: issuesRefreshSpinClass,
    handleClick: handleIssuesRefreshClick,
  } = useRefreshSpin(handleIssuesRefresh, false);
  const issueActions = useMemo<SectionHeaderAction[]>(
    () => [
      makeSectionFilterAction({
        key: "issues-filter",
        isOpen: showIssuesFilter,
        hasQuery: issuesFilterQuery.length > 0,
        onToggle: handleToggleIssuesFilter,
        tooltip: t("common:actions.search"),
      }),
      {
        key: "refresh-issues",
        icon: (
          <HugeiconsIcon
            icon={Refresh04Icon}
            data-icon="refresh-cw"
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            className={issuesRefreshSpinClass}
          />
        ),
        tooltip: t("common:actions.refresh", "Refresh"),
        onClick: handleIssuesRefreshClick,
      },
      {
        key: "new-issue",
        icon: (
          <HugeiconsIcon
            icon={CircleDotIcon}
            data-icon="circle-dot"
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
          />
        ),
        tooltip: "New issue",
        onClick: () => {
          issueCallbacks.openNewIssueForm?.();
        },
      },
    ],
    [
      showIssuesFilter,
      issuesFilterQuery,
      handleToggleIssuesFilter,
      handleIssuesRefreshClick,
      issuesRefreshSpinClass,
      issueCallbacks,
      t,
    ]
  );

  const issuesContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col">
        <React.Suspense fallback={<AlternateModeFallback />}>
          <IssuesContent
            repoPath={repoPath}
            repoId={repoId}
            branchName={branchName}
            showFilter={showIssuesFilter}
            filterQuery={issuesFilterQuery}
            onFilterQueryChange={setIssuesFilterQuery}
            onFilterClose={clearIssuesFilter}
          />
        </React.Suspense>
      </div>
    ),
    [
      repoPath,
      repoId,
      branchName,
      showIssuesFilter,
      issuesFilterQuery,
      setIssuesFilterQuery,
      clearIssuesFilter,
    ]
  );

  return { issueActions, issuesContent };
}
