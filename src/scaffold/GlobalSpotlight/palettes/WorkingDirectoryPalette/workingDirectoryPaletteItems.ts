import type React from "react";

import { isSystemPathRepoItem } from "@src/features/SessionCreator/utils/systemPathSource";
import { type CachedRepo, REPO_KIND } from "@src/store/repo";

import type { RepoItem, SpotlightItem } from "../../types";
import {
  buildRepoSpotlightItems,
  sortRepoItemsSelectedFirst,
} from "../adapters";
import {
  WORKING_DIRECTORY_PALETTE_SECTION_KEY,
  type WorkingDirectoryPaletteSectionKey,
  type WorkingDirectoryPaletteText,
} from "./types";

function buildSectionHeader(
  key: WorkingDirectoryPaletteSectionKey,
  label: string
): SpotlightItem {
  return {
    id: `__header_repo_${key}__`,
    label,
    desc: "",
    icon: "",
    type: "option",
    data: { isHeader: true },
    action: () => {},
  };
}

function appendSection(
  target: SpotlightItem[],
  key: WorkingDirectoryPaletteSectionKey,
  label: string,
  sectionItems: SpotlightItem[]
) {
  if (sectionItems.length === 0) return;
  target.push(buildSectionHeader(key, label), ...sectionItems);
}

interface BuildSectionedWorkingDirectoryItemsArgs {
  addMenuActive: boolean;
  sectionedAddItems: SpotlightItem[];
  workspaceItems: SpotlightItem[];
  openPathItem: SpotlightItem | null;
  filteredRepos: RepoItem[];
  externalRecentRepos?: readonly RepoItem[];
  recentCachedRepos?: readonly CachedRepo[];
  currentRepoId?: string;
  isMultiRoot: boolean;
  isManageMode: boolean;
  leadingRepos?: readonly RepoItem[];
  selectedIds: Set<string>;
  searchQuery: string;
  paletteText: WorkingDirectoryPaletteText;
  /**
   * Org-scope membership predicate. When set, repo/workspace sections are
   * replaced by a "This org" / "Outside this org" split instead of hiding
   * non-matching rows. Workspace items carry their own `outsideOrgScope`
   * data flag (set by useWorkingDirectoryPaletteWorkspaces).
   */
  orgScopeFilter?: ((repo: RepoItem) => boolean) | null;
  /** Renders each repo row's filesystem path under its name (footer toggle). */
  showPath?: boolean;
  onRepoAction: (repo: RepoItem) => void;
  onLeadingRepoAction: (repo: RepoItem) => void;
  toggleSelection: (id: string) => void;
  renderRepoTrashAction?: (repo: RepoItem) => React.ReactNode;
}

export function buildSectionedWorkingDirectoryItems({
  addMenuActive,
  sectionedAddItems,
  workspaceItems,
  openPathItem,
  filteredRepos,
  externalRecentRepos = [],
  recentCachedRepos = [],
  currentRepoId,
  isMultiRoot,
  isManageMode,
  leadingRepos = [],
  selectedIds,
  searchQuery,
  paletteText,
  orgScopeFilter = null,
  showPath = false,
  onRepoAction,
  onLeadingRepoAction,
  toggleSelection,
  renderRepoTrashAction,
}: BuildSectionedWorkingDirectoryItemsArgs): SpotlightItem[] {
  if (addMenuActive) {
    return sectionedAddItems;
  }

  // System-path rows never run through the org predicate — resolving git
  // remotes against e.g. the user's home directory is wasted priming.
  const outsideOrgRepoIds = orgScopeFilter
    ? new Set(
        filteredRepos
          .filter(
            (repo) => !isSystemPathRepoItem(repo) && !orgScopeFilter(repo)
          )
          .map((repo) => repo.id)
      )
    : null;

  const persistedFolderRepos = filteredRepos.filter(
    (repo) => !isSystemPathRepoItem(repo) && repo.kind === REPO_KIND.FOLDER
  );
  const persistedGitRepos = filteredRepos.filter(
    (repo) => repo.kind !== REPO_KIND.FOLDER
  );

  const repoItemOptions = {
    currentRepoId: isMultiRoot ? undefined : currentRepoId,
    showPath,
    onAction: onRepoAction,
    manageAction: isManageMode ? renderRepoTrashAction : undefined,
    getSelectionState: isManageMode
      ? (repo: RepoItem) => ({
          checked: selectedIds.has(repo.id),
          onToggle: () => toggleSelection(repo.id),
        })
      : undefined,
  };

  const repoItems = sortRepoItemsSelectedFirst(
    buildRepoSpotlightItems(persistedGitRepos, repoItemOptions)
  );

  const workingDirectoryItems = sortRepoItemsSelectedFirst(
    buildRepoSpotlightItems(persistedFolderRepos, repoItemOptions)
  );

  const leadingRepoItems =
    leadingRepos.length > 0 && !isManageMode
      ? buildRepoSpotlightItems([...leadingRepos], {
          currentRepoId,
          showPath,
          onAction: onLeadingRepoAction,
        })
      : [];

  const externalRecentItems =
    externalRecentRepos.length > 0 && !isManageMode
      ? buildRepoSpotlightItems([...externalRecentRepos], {
          currentRepoId,
          showPath,
          onAction: onLeadingRepoAction,
        })
      : [];

  const recentCachedRepoRanks = new Map(
    recentCachedRepos.map((repo, index) => [repo.id, index])
  );
  const isOutsideOrgItem = (item: SpotlightItem) =>
    !!outsideOrgRepoIds &&
    (outsideOrgRepoIds.has(item.id) || item.data?.outsideOrgScope === true);
  // With an org scope active, Recent is scoped to the org too — out-of-org
  // rows appear only under "Outside this org", never in Recent.
  const recentEligible = (item: SpotlightItem) =>
    recentCachedRepoRanks.has(item.id) && !isOutsideOrgItem(item);
  const recentItems = !isManageMode
    ? [
        ...repoItems.filter(recentEligible),
        ...workingDirectoryItems.filter(recentEligible),
        ...leadingRepoItems.filter(recentEligible),
        ...workspaceItems.filter((item) => !isOutsideOrgItem(item)),
      ]
        .sort((itemA, itemB) => {
          const rankA = recentCachedRepoRanks.get(itemA.id);
          const rankB = recentCachedRepoRanks.get(itemB.id);
          if (rankA !== undefined || rankB !== undefined) {
            return (
              (rankA ?? Number.MAX_SAFE_INTEGER) -
              (rankB ?? Number.MAX_SAFE_INTEGER)
            );
          }
          return String(itemB.data?.updatedAt ?? "").localeCompare(
            String(itemA.data?.updatedAt ?? "")
          );
        })
        .slice(0, 3)
    : [];
  const recentIds = new Set(recentItems.map((item) => item.id));

  const sourceItems = [
    ...leadingRepoItems,
    ...externalRecentItems,
    ...workingDirectoryItems,
    ...repoItems,
  ];

  const currentItems = [...workspaceItems, ...sourceItems].filter(
    (item) => item.data?.isCurrentSelection
  );
  const currentIds = new Set(currentItems.map((item) => item.id));
  const regularSystemPathItems = leadingRepoItems.filter(
    (item) => !currentIds.has(item.id) && !recentIds.has(item.id)
  );
  const regularExternalRecentItems = externalRecentItems.filter(
    (item) => !currentIds.has(item.id)
  );
  const regularWorkingDirectoryItems = workingDirectoryItems.filter(
    (item) => !currentIds.has(item.id) && !recentIds.has(item.id)
  );
  const regularRepoItems = repoItems.filter(
    (item) => !currentIds.has(item.id) && !recentIds.has(item.id)
  );
  const regularWorkspaceItems = workspaceItems.filter(
    (item) => !currentIds.has(item.id) && !recentIds.has(item.id)
  );
  const sectionedItems: SpotlightItem[] = [];

  if (searchQuery.trim() && openPathItem) {
    sectionedItems.push(openPathItem);
  }

  appendSection(
    sectionedItems,
    WORKING_DIRECTORY_PALETTE_SECTION_KEY.RECENT,
    paletteText.sectionRecentLabel,
    [...currentItems, ...recentItems.filter((item) => !currentIds.has(item.id))]
  );
  if (outsideOrgRepoIds) {
    const inThisOrg = (items: SpotlightItem[]) =>
      items.filter((item) => !isOutsideOrgItem(item));
    const outsideOrg = (items: SpotlightItem[]) =>
      items.filter(isOutsideOrgItem);

    appendSection(
      sectionedItems,
      WORKING_DIRECTORY_PALETTE_SECTION_KEY.THIS_ORG,
      paletteText.sectionThisOrgLabel,
      [
        ...inThisOrg(regularRepoItems),
        ...inThisOrg(regularWorkspaceItems),
        ...inThisOrg(regularWorkingDirectoryItems),
      ]
    );
    appendSection(
      sectionedItems,
      WORKING_DIRECTORY_PALETTE_SECTION_KEY.OUTSIDE_ORG,
      paletteText.sectionOutsideOrgLabel,
      [
        ...outsideOrg(regularRepoItems),
        ...outsideOrg(regularWorkspaceItems),
        ...outsideOrg(regularWorkingDirectoryItems),
      ]
    );
  } else {
    appendSection(
      sectionedItems,
      WORKING_DIRECTORY_PALETTE_SECTION_KEY.REPO,
      paletteText.sectionRepoLabel,
      regularRepoItems
    );
    appendSection(
      sectionedItems,
      WORKING_DIRECTORY_PALETTE_SECTION_KEY.MULTI_REPO_WORKSPACE,
      paletteText.sectionMultiRepoWorkingDirectoryLabel,
      regularWorkspaceItems
    );
    appendSection(
      sectionedItems,
      WORKING_DIRECTORY_PALETTE_SECTION_KEY.WORKING_DIRECTORY,
      paletteText.sectionWorkingDirectoryLabel,
      regularWorkingDirectoryItems
    );
  }
  appendSection(
    sectionedItems,
    WORKING_DIRECTORY_PALETTE_SECTION_KEY.SYSTEM_PATH,
    paletteText.sectionSystemPathsLabel,
    regularSystemPathItems
  );
  appendSection(
    sectionedItems,
    WORKING_DIRECTORY_PALETTE_SECTION_KEY.EXTERNAL_RECENT,
    paletteText.sectionExternalRecentLabel,
    regularExternalRecentItems
  );

  return sectionedItems;
}

export function buildSectionedAddItems(
  addWorkingDirectoryItems: SpotlightItem[]
): SpotlightItem[] {
  return addWorkingDirectoryItems;
}
