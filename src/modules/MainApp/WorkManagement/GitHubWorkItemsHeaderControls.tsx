import type { ReactNode } from "react";

import Select from "@src/components/Select";
import { WorkManagementSearchInput } from "@src/features/GitHubWork/WorkManagementSearchInput";
import { compactRepositoryLabel } from "@src/features/GitHubWork/githubRepositoryLabel";

import {
  GitHubWorkItemStateTabs,
  GitHubWorkItemToolbarActions,
} from "./GitHubWorkItemList";
import {
  GitHubWorkItemsFilterMenu,
  type GitHubWorkItemsFilterMenuProps,
} from "./GitHubWorkItemsFilterMenu";
import type { IssueRepoFilter, RepoFilterOption } from "./githubWorkItemsTypes";

export interface GitHubWorkItemsHeaderControlsProps {
  stateTabs: Array<{ key: string; label: string }>;
  activeState: string;
  searchQuery: string;
  /** Omitted where the header offers no filter popover. */
  filterMenu?: GitHubWorkItemsFilterMenuProps;
  refreshLabel: string;
  refreshing: boolean;
  createAction?: {
    label: string;
    disabled: boolean;
    onClick: () => void;
  };
  onStateChange: (state: string) => void;
  onSearchQueryChange: (query: string) => void;
  onRefresh: () => void;
}

export function GitHubWorkItemsFilterControls({
  stateTabs,
  activeState,
  filterMenu,
  onStateChange,
}: Pick<
  GitHubWorkItemsHeaderControlsProps,
  "stateTabs" | "activeState" | "filterMenu" | "onStateChange"
>): ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-px">
      <GitHubWorkItemStateTabs
        tabs={stateTabs}
        activeTab={activeState}
        onChange={onStateChange}
      />
      {filterMenu ? <GitHubWorkItemsFilterMenu {...filterMenu} /> : null}
    </div>
  );
}

export function GitHubWorkItemsSearchAndActions({
  searchQuery,
  refreshLabel,
  refreshing,
  createAction,
  onSearchQueryChange,
  onRefresh,
  fillSearch = false,
}: Pick<
  GitHubWorkItemsHeaderControlsProps,
  | "searchQuery"
  | "refreshLabel"
  | "refreshing"
  | "createAction"
  | "onSearchQueryChange"
  | "onRefresh"
> & {
  /** A split-list header search grows before the action buttons. */
  fillSearch?: boolean;
}): ReactNode {
  return (
    <div
      className={`flex min-w-0 items-center gap-px ${
        fillSearch ? "flex-1" : ""
      }`.trim()}
    >
      <WorkManagementSearchInput
        value={searchQuery}
        onChange={onSearchQueryChange}
        placement="header"
        fillWidth={fillSearch}
        dataTestId="github-work-items-search"
      />
      <GitHubWorkItemToolbarActions
        refreshLabel={refreshLabel}
        refreshing={refreshing}
        createAction={createAction}
        onRefresh={onRefresh}
      />
    </div>
  );
}

interface GitHubWorkItemsRepositorySelectProps {
  repoOptions: RepoFilterOption[];
  selectedRepo: IssueRepoFilter;
  /** True until the repository list has resolved a selection. */
  loading?: boolean;
  onRepoSelect: (repo: IssueRepoFilter) => void;
}

/** Repository scope published beside the GitHub PR/issues dataset selector. */
export function GitHubWorkItemsRepositorySelect({
  repoOptions,
  selectedRepo,
  loading = false,
  onRepoSelect,
}: GitHubWorkItemsRepositorySelectProps): ReactNode {
  return (
    <Select
      value={selectedRepo}
      loading={loading}
      options={repoOptions.map((option) => ({
        value: option.key,
        label: compactRepositoryLabel(option.label),
        triggerLabel: compactRepositoryLabel(option.label),
      }))}
      onChange={(value) => {
        if (Array.isArray(value)) return;
        onRepoSelect(String(value));
      }}
      size="small"
      appearance="ghost"
      radius="lg"
      dropdownWidthMode="auto"
      dropdownMinWidth={190}
      dropdownAlign="left"
      className="w-auto"
      dataTestId="github-work-items-repository"
    />
  );
}
