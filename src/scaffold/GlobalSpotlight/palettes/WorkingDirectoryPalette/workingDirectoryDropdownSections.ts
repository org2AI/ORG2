/**
 * WorkingDirectoryDropdown — section assembly.
 *
 * Groups the dropdown's rows into labelled sections: the open-path action,
 * Recent (active workspace + current repo + up to three recent picks), the
 * org-scoped or plain repo / workspace / folder sections, system paths, and
 * paths seen in other tools.
 */
import type { TFunction } from "i18next";

import { isSystemPathRepoItem } from "@src/features/SessionCreator/utils/systemPathSource";
import { REPO_KIND } from "@src/store/repo";

import type { WorkspaceSwitchEntry } from "../../hooks";
import type { RepoItem, SpotlightItem } from "../../types";
import type {
  DropdownRepoItem,
  DropdownRepoRowItem,
  DropdownWorkspaceRowItem,
  WorkingDirectoryDropdownSection,
} from "./workingDirectoryDropdownTypes";

interface BuildWorkingDirectoryDropdownSectionsInput {
  leadingRepos: readonly RepoItem[];
  filteredRepos: readonly RepoItem[];
  externalRecentRepos: readonly RepoItem[];
  currentRepoId: string | undefined;
  /** Recently used repos, most recent first; index doubles as the rank. */
  cachedRepos: readonly { id: string }[];
  outsideOrgRepoIds: Set<string> | null;
  outsideOrgWorkspaceIds: Set<string> | null;
  filteredWorkspaces: readonly WorkspaceSwitchEntry[];
  searchQuery: string;
  openPathItem: SpotlightItem | null;
  orgScopeName: string | undefined;
  t: TFunction;
}

export function buildWorkingDirectoryDropdownSections({
  leadingRepos,
  filteredRepos,
  externalRecentRepos,
  currentRepoId,
  cachedRepos,
  outsideOrgRepoIds,
  outsideOrgWorkspaceIds,
  filteredWorkspaces,
  searchQuery,
  openPathItem,
  orgScopeName,
  t,
}: BuildWorkingDirectoryDropdownSectionsInput): WorkingDirectoryDropdownSection[] {
  const allRepos = [...leadingRepos, ...filteredRepos];
  const currentItems: DropdownRepoRowItem[] = [];
  const systemItems: DropdownRepoRowItem[] = [];
  const externalRecentItems: DropdownRepoRowItem[] = externalRecentRepos.map(
    (repo) => ({ kind: "repo", repo })
  );
  const workingDirectoryItems: DropdownRepoRowItem[] = [];
  const repoItems: DropdownRepoRowItem[] = [];

  for (const repo of allRepos) {
    const item: DropdownRepoRowItem = { kind: "repo", repo };
    if (repo.id === currentRepoId) {
      currentItems.push(item);
    } else if (isSystemPathRepoItem(repo)) {
      systemItems.push(item);
    } else if (repo.kind === REPO_KIND.FOLDER) {
      workingDirectoryItems.push(item);
    } else {
      repoItems.push(item);
    }
  }

  const recentRepoRanks = new Map(
    cachedRepos.map((repo, index) => [repo.id, index])
  );
  // With an org scope active, Recent is scoped to the org too — out-of-org
  // rows appear only under "Outside this org", never in Recent.
  const recentRepoItems = [
    ...repoItems,
    ...workingDirectoryItems,
    ...systemItems,
  ]
    .filter(
      (item) =>
        recentRepoRanks.has(item.repo.id) &&
        !outsideOrgRepoIds?.has(item.repo.id)
    )
    .sort(
      (itemA, itemB) =>
        (recentRepoRanks.get(itemA.repo.id) ?? Number.MAX_SAFE_INTEGER) -
        (recentRepoRanks.get(itemB.repo.id) ?? Number.MAX_SAFE_INTEGER)
    );

  // Active selections lead Recent, followed by other recent entries.
  const activeWorkspaceItems: DropdownWorkspaceRowItem[] = [];
  const inactiveWorkspaceItems: DropdownWorkspaceRowItem[] = [];
  for (const entry of filteredWorkspaces) {
    const item: DropdownWorkspaceRowItem = { kind: "workspace", entry };
    if (entry.isActive) {
      activeWorkspaceItems.push(item);
    } else {
      inactiveWorkspaceItems.push(item);
    }
  }

  inactiveWorkspaceItems.sort((itemA, itemB) =>
    itemB.entry.workspace.updatedAt.localeCompare(
      itemA.entry.workspace.updatedAt
    )
  );
  const recentItems = [
    ...recentRepoItems,
    ...inactiveWorkspaceItems.filter(
      (item) => !outsideOrgWorkspaceIds?.has(item.entry.workspace.workspaceId)
    ),
  ].slice(0, 3);
  const recentRepoIds = new Set(
    recentItems
      .filter((item): item is DropdownRepoRowItem => item.kind === "repo")
      .map((item) => item.repo.id)
  );
  const recentWorkspaceIds = new Set(
    recentItems
      .filter(
        (item): item is DropdownWorkspaceRowItem => item.kind === "workspace"
      )
      .map((item) => item.entry.workspace.workspaceId)
  );

  const nextSections: WorkingDirectoryDropdownSection[] = [];
  if (searchQuery.trim() && openPathItem) {
    nextSections.push({
      key: "openPath",
      label: null,
      items: [{ kind: "openPath", item: openPathItem }],
    });
  }
  const displayedRecentItems = [
    ...activeWorkspaceItems,
    ...currentItems,
    ...recentItems,
  ];
  if (displayedRecentItems.length > 0) {
    nextSections.push({
      key: "recent",
      label: t("selectors.repo.sections.recent"),
      items: displayedRecentItems,
    });
  }
  const regularRepoItems = repoItems.filter(
    (item) => !recentRepoIds.has(item.repo.id)
  );
  const regularInactiveWorkspaceItems = inactiveWorkspaceItems.filter(
    (item) => !recentWorkspaceIds.has(item.entry.workspace.workspaceId)
  );
  const regularFolderWorkspaceItems = workingDirectoryItems.filter(
    (item) => !recentRepoIds.has(item.repo.id)
  );
  if (outsideOrgRepoIds) {
    const isOutsideOrgItem = (item: DropdownRepoItem) =>
      item.kind === "repo"
        ? outsideOrgRepoIds.has(item.repo.id)
        : item.kind === "workspace"
          ? !!outsideOrgWorkspaceIds?.has(item.entry.workspace.workspaceId)
          : false;
    const orgOrdered: DropdownRepoItem[] = [
      ...regularRepoItems,
      ...regularInactiveWorkspaceItems,
      ...regularFolderWorkspaceItems,
    ];
    const thisOrgItems = orgOrdered.filter((item) => !isOutsideOrgItem(item));
    const outsideOrgItems = orgOrdered.filter(isOutsideOrgItem);
    if (thisOrgItems.length > 0) {
      nextSections.push({
        key: "thisOrg",
        label: orgScopeName ?? t("selectors.repo.sections.thisOrg"),
        items: thisOrgItems,
      });
    }
    if (outsideOrgItems.length > 0) {
      nextSections.push({
        key: "outsideOrg",
        label: orgScopeName
          ? t("selectors.repo.sections.outsideNamedOrg", {
              org: orgScopeName,
            })
          : t("selectors.repo.sections.outsideOrg"),
        items: outsideOrgItems,
      });
    }
  } else {
    if (regularRepoItems.length > 0) {
      nextSections.push({
        key: "repo",
        label: t("selectors.repo.sections.repo"),
        items: regularRepoItems,
      });
    }
    if (regularInactiveWorkspaceItems.length > 0) {
      nextSections.push({
        key: "multiRepoWorkspace",
        label: t("workspaceForm.multiRepoWorkspace"),
        items: regularInactiveWorkspaceItems,
      });
    }
    if (regularFolderWorkspaceItems.length > 0) {
      nextSections.push({
        key: "workspace",
        label: t("selectors.repo.sections.workspace"),
        items: regularFolderWorkspaceItems,
      });
    }
  }
  const regularSystemItems = systemItems.filter(
    (item) => !recentRepoIds.has(item.repo.id)
  );
  if (regularSystemItems.length > 0) {
    nextSections.push({
      key: "system",
      label: t("selectors.repo.sections.systemPaths"),
      items: regularSystemItems,
    });
  }
  if (externalRecentItems.length > 0) {
    nextSections.push({
      key: "externalRecent",
      label: t("selectors.repo.sections.usedElsewhere"),
      items: externalRecentItems,
    });
  }
  return nextSections;
}
