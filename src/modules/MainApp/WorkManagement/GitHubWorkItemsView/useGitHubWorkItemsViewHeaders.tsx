import type { TFunction } from "i18next";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";

import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import SplitListFullscreenButton from "@src/scaffold/layouts/SplitListFullscreenButton";
import SplitListHeader from "@src/scaffold/layouts/SplitListHeader";

import {
  GitHubWorkItemsFilterControls,
  GitHubWorkItemsRepositorySelect,
  GitHubWorkItemsSearchAndActions,
} from "../GitHubWorkItemsHeaderControls";
import type { GitHubWorkItemFacets } from "../githubWorkItemsFilterFacets";
import {
  GITHUB_QUERY_SCOPE,
  GITHUB_QUERY_STATE,
  type GitHubQueryScope,
  type ParsedGitHubSearchQuery,
} from "../githubWorkItemsSearchQuery";
import type {
  GitHubRepoSource,
  IssueRepoFilter,
  RepoFilterOption,
} from "../githubWorkItemsTypes";
import { useWorkManagementSplitHeader } from "../workManagementSplitHeaderContext";

/** The split-mode and full-width header rows above the GitHub work item list. */
export function useGitHubWorkItemsViewHeaders({
  t,
  scope,
  loading,
  repoSources,
  repoOptions,
  effectiveSelectedRepo,
  searchQuery,
  parsedSearchQuery,
  filterFacets,
  listFullscreen,
  setListFullscreen,
  updateSearchQuery,
  onSearchQueryChange,
  onRepoSelect,
  onRefresh,
  onSetCreateFormOpen,
}: {
  t: TFunction;
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  loading: boolean;
  repoSources: GitHubRepoSource[];
  repoOptions: RepoFilterOption[];
  effectiveSelectedRepo: IssueRepoFilter;
  searchQuery: string;
  parsedSearchQuery: ParsedGitHubSearchQuery;
  filterFacets: GitHubWorkItemFacets;
  listFullscreen: boolean;
  setListFullscreen: Dispatch<SetStateAction<boolean>>;
  updateSearchQuery: (mutate: (query: ParsedGitHubSearchQuery) => void) => void;
  onSearchQueryChange: (query: string) => void;
  onRepoSelect: (repo: IssueRepoFilter) => void;
  onRefresh: () => void;
  onSetCreateFormOpen: (open: boolean) => void;
}) {
  const { splitDatasetControl, surfaceDatasetControl } =
    useWorkManagementSplitHeader();
  const activeState =
    scope === GITHUB_QUERY_SCOPE.PR &&
    parsedSearchQuery.state === GITHUB_QUERY_STATE.MERGED
      ? GITHUB_QUERY_STATE.CLOSED
      : (parsedSearchQuery.state ?? GITHUB_QUERY_STATE.OPEN);
  const stateTabs = useMemo(
    () => [
      {
        key: GITHUB_QUERY_STATE.OPEN,
        label: t("chat.panels.manageIssues.stateOpen"),
      },
      {
        key: GITHUB_QUERY_STATE.CLOSED,
        label: t("chat.panels.manageIssues.stateClosed"),
      },
    ],
    [t]
  );
  const handleStateChange = useCallback(
    (state: string) => {
      if (
        state !== GITHUB_QUERY_STATE.OPEN &&
        state !== GITHUB_QUERY_STATE.CLOSED
      ) {
        return;
      }
      updateSearchQuery((query) => {
        query.state = state;
      });
    },
    [updateSearchQuery]
  );

  const sharedHeaderControlsProps = useMemo(
    () => ({
      stateTabs,
      activeState,
      searchQuery,
      filterMenu: {
        scope,
        facets: filterFacets,
        parsedSearchQuery,
        updateSearchQuery,
      },
      refreshLabel: t("common:actions.refresh"),
      refreshing: loading,
      createAction:
        scope === GITHUB_QUERY_SCOPE.ISSUE
          ? {
              label: t("chat.panels.manageIssues.createIssueTrigger"),
              disabled: repoSources.length === 0,
              onClick: () => onSetCreateFormOpen(true),
            }
          : undefined,
      onStateChange: handleStateChange,
      onSearchQueryChange,
      onRefresh,
    }),
    [
      activeState,
      filterFacets,
      handleStateChange,
      loading,
      onRefresh,
      onSearchQueryChange,
      onSetCreateFormOpen,
      parsedSearchQuery,
      repoSources.length,
      scope,
      searchQuery,
      stateTabs,
      t,
      updateSearchQuery,
    ]
  );
  const repositoryHeaderContent = useMemo(
    () => (
      <GitHubWorkItemsRepositorySelect
        repoOptions={repoOptions}
        selectedRepo={effectiveSelectedRepo}
        loading={loading && !effectiveSelectedRepo}
        onRepoSelect={onRepoSelect}
      />
    ),
    [effectiveSelectedRepo, loading, onRepoSelect, repoOptions]
  );
  const headerTrailing = useMemo(
    () => (
      <div className="flex min-w-0 items-center gap-px">
        <GitHubWorkItemsSearchAndActions {...sharedHeaderControlsProps} />
        <SplitListFullscreenButton
          isFullscreen={listFullscreen}
          onToggle={() => setListFullscreen((current) => !current)}
        />
      </div>
    ),
    [listFullscreen, setListFullscreen, sharedHeaderControlsProps]
  );
  // Every split presentation owns its controls in the left-column header.
  const useSplitListHeader = !listFullscreen;
  const splitListHeader = useMemo(
    () =>
      useSplitListHeader ? (
        <SplitListHeader
          primary={
            <div className="flex min-w-0 flex-1 items-center gap-px">
              {repositoryHeaderContent}
              <HeaderSectionSeparator className="mx-0.5" />
              <GitHubWorkItemsFilterControls {...sharedHeaderControlsProps} />
            </div>
          }
          secondary={
            <div className="flex min-w-0 flex-1 items-center gap-px">
              {splitDatasetControl}
              {splitDatasetControl ? (
                <HeaderSectionSeparator className="mx-0.5" />
              ) : null}
              <GitHubWorkItemsSearchAndActions
                {...sharedHeaderControlsProps}
                fillSearch
              />
              <SplitListFullscreenButton
                isFullscreen={listFullscreen}
                onToggle={() => setListFullscreen((current) => !current)}
              />
            </div>
          }
        />
      ) : null,
    [
      listFullscreen,
      repositoryHeaderContent,
      setListFullscreen,
      sharedHeaderControlsProps,
      splitDatasetControl,
      useSplitListHeader,
    ]
  );
  const fullListHeader = useMemo(
    () =>
      !useSplitListHeader ? (
        <SplitListHeader
          fullWidth
          primary={
            <div className="flex min-w-0 flex-1 items-center gap-px">
              {surfaceDatasetControl}
              {surfaceDatasetControl ? (
                <HeaderSectionSeparator className="mx-0.5" />
              ) : null}
              {repositoryHeaderContent}
              <HeaderSectionSeparator className="mx-0.5" />
              <GitHubWorkItemsFilterControls {...sharedHeaderControlsProps} />
              <div className="ml-auto flex min-w-0 items-center gap-px">
                {headerTrailing}
              </div>
            </div>
          }
        />
      ) : null,
    [
      headerTrailing,
      repositoryHeaderContent,
      sharedHeaderControlsProps,
      surfaceDatasetControl,
      useSplitListHeader,
    ]
  );

  return { splitListHeader, fullListHeader };
}
