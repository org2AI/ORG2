import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  WorkManagementTable,
  type WorkManagementTableRow,
} from "@src/features/GitHubWork/WorkManagementTable";
import { usePublishWorkstationTabHeader } from "@src/hooks/tabHost/useWorkstationTabHeader";
import InboxListDetailLayout from "@src/scaffold/layouts/InboxListDetailLayout";

import { CreateIssueModal } from "./CreateIssueModal";
import GitHubWorkItemDetailPane from "./GitHubWorkItemDetailPane";
import GitHubWorkItemsCompactList from "./GitHubWorkItemsCompactList";
import { GitHubWorkItemsTableEmptyState } from "./GitHubWorkItemsView/GitHubWorkItemsTableEmptyState";
import {
  buildManagedIssueTableRow,
  buildManagedPrTableRow,
} from "./GitHubWorkItemsView/githubWorkItemsTableRows";
import { useGitHubWorkItemsViewHeaders } from "./GitHubWorkItemsView/useGitHubWorkItemsViewHeaders";
import {
  GITHUB_ITEM_KIND,
  type ManagedGitHubItem,
  type ManagedIssueItem,
  type ManagedPrItem,
} from "./githubManagedItemModel";
import { findGitHubRepoSource } from "./githubWorkItemPermissions";
import type { GitHubWorkItemFacets } from "./githubWorkItemsFilterFacets";
import {
  GITHUB_WORK_ITEMS_PAGE_SIZE,
  canAdvanceGitHubWorkItemsPage,
} from "./githubWorkItemsPagination";
import {
  GITHUB_QUERY_SCOPE,
  type GitHubQueryScope,
  type ParsedGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";
import type { GitHubWorkItemsSort } from "./githubWorkItemsSort";
import type {
  GitHubRepoSource,
  IssueRepoFilter,
  RepoFilterOption,
} from "./githubWorkItemsTypes";
import type { IssueAssigneeControlState } from "./useGitHubIssueAssigneeMutations";
import type {
  ManagedIssueStatusValue,
  ManagedPrStatusValue,
} from "./useGitHubWorkItemStatusMutations";

export { getManagedIssueStatusAccent } from "./GitHubWorkItemsView/githubWorkItemsTableRows";

interface GitHubWorkItemsViewProps {
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  loading: boolean;
  loadError: string | null;
  loadingMore: boolean;
  allItemsCount: number;
  filteredItems: ManagedGitHubItem[];
  pagedItems: ManagedGitHubItem[];
  selectedItem: ManagedGitHubItem | null;
  repoSources: GitHubRepoSource[];
  repoOptions: RepoFilterOption[];
  effectiveSelectedRepo: IssueRepoFilter;
  selectedRepoSourceForCreate: GitHubRepoSource | null;
  searchQuery: string;
  parsedSearchQuery: ParsedGitHubSearchQuery;
  filterFacets: GitHubWorkItemFacets;
  currentPage: number;
  totalLoadedPages: number;
  hasMoreFilteredIssues: boolean;
  sort: GitHubWorkItemsSort;
  createFormOpen: boolean;
  creatingIssue: boolean;
  updateSearchQuery: (mutate: (query: ParsedGitHubSearchQuery) => void) => void;
  onSearchQueryChange: (query: string) => void;
  onRepoSelect: (repo: IssueRepoFilter) => void;
  onRefresh: () => void;
  /** Jump directly to an already-loaded page (1-based). */
  onGoToPage: (page: number) => void;
  onNextPage: () => Promise<void>;
  onLoadMore: () => void;
  onSortChange: (sort: GitHubWorkItemsSort) => void;
  onSelectItem: (item: ManagedGitHubItem) => void;
  onCloseItem: () => void;
  onOpenIssue: (issue: ManagedIssueItem) => void;
  onOpenIssueInBrowser: (issue: ManagedIssueItem) => void;
  onAddIssue: (issue: ManagedIssueItem) => void;
  onIssueStatusChange: (
    issue: ManagedIssueItem,
    status: ManagedIssueStatusValue
  ) => Promise<void>;
  getIssueAssigneeControlState: (
    issue: ManagedIssueItem
  ) => IssueAssigneeControlState;
  onLoadIssueAssignees: (issue: ManagedIssueItem) => void | Promise<void>;
  onIssueAssigneesChange: (
    issue: ManagedIssueItem,
    assignees: string[]
  ) => void | Promise<void>;
  onOpenPr: (pr: ManagedPrItem) => void;
  onAddPr: (pr: ManagedPrItem) => void;
  onPrStatusChange: (
    pr: ManagedPrItem,
    status: ManagedPrStatusValue
  ) => Promise<void>;
  onSetCreateFormOpen: (open: boolean) => void;
  onCreateIssue: (
    source: GitHubRepoSource,
    title: string,
    body: string
  ) => void;
}

export function GitHubWorkItemsView({
  scope,
  loading,
  loadError,
  loadingMore,
  allItemsCount,
  filteredItems,
  pagedItems,
  selectedItem,
  repoSources,
  repoOptions,
  effectiveSelectedRepo,
  selectedRepoSourceForCreate,
  searchQuery,
  parsedSearchQuery,
  filterFacets,
  currentPage,
  totalLoadedPages,
  hasMoreFilteredIssues,
  sort,
  createFormOpen,
  creatingIssue,
  updateSearchQuery,
  onSearchQueryChange,
  onRepoSelect,
  onRefresh,
  onGoToPage,
  onNextPage,
  onLoadMore,
  onSortChange,
  onSelectItem,
  onCloseItem,
  onOpenIssue,
  onOpenIssueInBrowser,
  onAddIssue,
  onIssueStatusChange,
  getIssueAssigneeControlState,
  onLoadIssueAssignees,
  onIssueAssigneesChange,
  onOpenPr,
  onAddPr,
  onPrStatusChange,
  onSetCreateFormOpen,
  onCreateIssue,
}: GitHubWorkItemsViewProps): React.ReactNode {
  const { t } = useTranslation(["sessions", "common"]);
  const [listFullscreen, setListFullscreen] = useState(false);
  const handleSelectItem = useCallback(
    (item: ManagedGitHubItem) => {
      // Selecting from the full-width table always returns to split so the
      // newly selected detail is visible immediately.
      setListFullscreen(false);
      onSelectItem(item);
    },
    [onSelectItem]
  );
  const readonlyReason = t("common:errors.forbidden");
  const { splitListHeader, fullListHeader } = useGitHubWorkItemsViewHeaders({
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
  });
  // Let the host keep its tab/title row; each layout mode owns its controls in
  // a local 36px surface row below it.
  const publishedHeader = useMemo(() => ({ hidden: true }), []);

  usePublishWorkstationTabHeader({
    host: "workManagement",
    content: publishedHeader,
  });

  const tableRows = useMemo<ManagedGitHubItem[]>(() => {
    if (scope === GITHUB_QUERY_SCOPE.PR) {
      return pagedItems.filter(
        (item): item is ManagedPrItem => item.kind === GITHUB_ITEM_KIND.PR
      );
    }
    return pagedItems.filter(
      (item): item is ManagedIssueItem => item.kind === GITHUB_ITEM_KIND.ISSUE
    );
  }, [pagedItems, scope]);
  const settingsRows = useMemo<WorkManagementTableRow[]>(
    () =>
      tableRows.map((item) => {
        const source = findGitHubRepoSource(
          repoSources,
          item.repo,
          item.repoPath
        );
        const updated = (
          <span title={item.updatedAt}>{item.timeAgo || "—"}</span>
        );
        if (item.kind === GITHUB_ITEM_KIND.PR) {
          return buildManagedPrTableRow({
            item,
            source,
            updated,
            t,
            readonlyReason,
            onPrStatusChange,
            onAddPr,
            onSelectItem: handleSelectItem,
          });
        }
        return buildManagedIssueTableRow({
          item,
          source,
          updated,
          t,
          readonlyReason,
          getIssueAssigneeControlState,
          onLoadIssueAssignees,
          onIssueAssigneesChange,
          onIssueStatusChange,
          onOpenIssueInBrowser,
          onAddIssue,
          onSelectItem: handleSelectItem,
        });
      }),
    [
      getIssueAssigneeControlState,
      onAddIssue,
      onAddPr,
      onIssueAssigneesChange,
      onIssueStatusChange,
      onLoadIssueAssignees,
      onOpenIssueInBrowser,
      handleSelectItem,
      onPrStatusChange,
      readonlyReason,
      repoSources,
      t,
      tableRows,
    ]
  );

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="work-management-github"
    >
      <CreateIssueModal
        open={createFormOpen}
        repoSources={repoSources}
        selectedRepo={selectedRepoSourceForCreate}
        creating={creatingIssue}
        labels={{
          title: t("chat.panels.manageIssues.newIssueTitle"),
          issueTitlePlaceholder: t(
            "chat.panels.manageIssues.issueTitlePlaceholder"
          ),
          issueBodyPlaceholder: t(
            "chat.panels.manageIssues.issueBodyPlaceholder"
          ),
          repository: t("chat.panels.manageIssues.repositoryLabel"),
          cancel: t("common:actions.cancel"),
          create: t("chat.panels.manageIssues.createIssue"),
          creating: t("chat.panels.manageIssues.creatingIssue"),
        }}
        onCreateIssue={onCreateIssue}
        onCancel={() => onSetCreateFormOpen(false)}
      />
      <section
        className="flex min-h-0 flex-1"
        data-testid={`work-management-github-${scope}`}
      >
        <InboxListDetailLayout
          testId={`github-${scope}-list-detail-layout`}
          defaultSplit
          listFullscreen={listFullscreen}
          listHeader={splitListHeader}
          fullHeader={fullListHeader}
          listContent={
            <GitHubWorkItemsCompactList
              scope={scope}
              items={filteredItems}
              selectedItem={selectedItem}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMoreFilteredIssues}
              onSelectItem={handleSelectItem}
              onLoadMore={onLoadMore}
            />
          }
          fullContent={
            <WorkManagementTable
              rows={settingsRows}
              loading={loading}
              noDataElement={
                <GitHubWorkItemsTableEmptyState
                  scope={scope}
                  loading={loading}
                  loadError={loadError}
                  allItemsCount={allItemsCount}
                  filteredItemsCount={filteredItems.length}
                  repoSourcesCount={repoSources.length}
                  onRefresh={onRefresh}
                />
              }
              sort={sort}
              onSortChange={onSortChange}
              testId={`github-${scope}-table`}
              pagination={
                filteredItems.length > 0
                  ? {
                      pageIndex: currentPage - 1,
                      pageSize: GITHUB_WORK_ITEMS_PAGE_SIZE,
                      total: filteredItems.length,
                      pageCount: totalLoadedPages,
                      canPreviousPage: currentPage > 1,
                      canNextPage:
                        !loadingMore &&
                        canAdvanceGitHubWorkItemsPage({
                          currentPage,
                          loadedPageCount: totalLoadedPages,
                          hasMoreRemoteItems: hasMoreFilteredIssues,
                        }),
                      onPageChange: (pageIndex) => {
                        const targetPage = pageIndex + 1;
                        if (targetPage <= totalLoadedPages) {
                          onGoToPage(targetPage);
                        } else if (targetPage > currentPage) {
                          // Beyond the loaded range: fetch one more remote page
                          // and advance a single step.
                          void onNextPage();
                        }
                      },
                      openEndedPageCount: hasMoreFilteredIssues,
                    }
                  : undefined
              }
            />
          }
          detailContent={
            <GitHubWorkItemDetailPane
              selectedItem={selectedItem}
              onOpenIssueInNewTab={onOpenIssue}
              onOpenPrInNewTab={onOpenPr}
              onClose={onCloseItem}
            />
          }
        />
      </section>
    </div>
  );
}
