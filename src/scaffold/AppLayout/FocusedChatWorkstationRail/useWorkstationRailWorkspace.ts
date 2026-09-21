/**
 * Workspace section of the focused-chat workstation rail: one group per
 * workspace root with its branch row, the group disclosure state, and the
 * icon-only shortcut set the collapsed 44px column shows instead.
 */
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FolderClosedIcon, InternetIcon, SquareTerminalIcon } from "@src/icons";
import { openBranchSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { workspaceGitStatusMapAtom } from "@src/store/git";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";
import {
  activeWorkspaceRootAtom,
  workspaceFoldersAtom,
} from "@src/store/workspace";
import { requestNewBrowserSessionAtom } from "@src/store/workstation";
import type { WorkstationTabHost } from "@src/store/workstation/tabHost";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";

import { FOCUSED_CHAT_RAIL_SECTIONS } from "./railSectionKeys";
import type {
  FocusedChatRailItem,
  FocusedChatRailSection,
  FocusedChatSessionContext,
} from "./types";

function secondaryWorkspaceGroupKey(folderId: string): string {
  return `workspace:${folderId}`;
}

export function useWorkstationRailWorkspace({
  activeBranchName,
  browserTab,
  openWorkstationHost,
  openWorkstationTab,
  t,
  workspaceItems,
}: {
  activeBranchName: string | undefined;
  browserTab: { tab: WorkStationTab } | undefined;
  openWorkstationHost: (host: WorkstationTabHost) => void;
  openWorkstationTab: (tab: WorkStationTab) => void;
  t: TFunction;
  workspaceItems: FocusedChatRailItem[];
}) {
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const secondaryWorkspaceGroupKeys = useMemo(
    () =>
      workspaceFolders
        .slice(1)
        .map((folder) => secondaryWorkspaceGroupKey(folder.id)),
    [workspaceFolders]
  );

  // Subagents, Sources and every workspace after the first start folded.
  // Workspace rows mount live Git totals and source rows read image bytes, so
  // this is both the requested presentation and the demand boundary for that
  // background work.
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(
    () => new Set(["subagents", "sources", ...secondaryWorkspaceGroupKeys])
  );
  const knownSecondaryWorkspaceGroupKeysRef = useRef(
    new Set(secondaryWorkspaceGroupKeys)
  );

  // Workspace presets can hydrate after the trail mounts. Fold roots that
  // arrive later without resetting disclosure choices for roots already seen.
  useEffect(() => {
    const knownKeys = knownSecondaryWorkspaceGroupKeysRef.current;
    const nextKeys = new Set(secondaryWorkspaceGroupKeys);
    setCollapsedGroupKeys((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of knownKeys) {
        if (!nextKeys.has(key) && next.delete(key)) changed = true;
      }
      for (const key of nextKeys) {
        if (!knownKeys.has(key) && !next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
    knownSecondaryWorkspaceGroupKeysRef.current = nextKeys;
  }, [secondaryWorkspaceGroupKeys]);

  const activeWorkspaceRoot = useAtomValue(activeWorkspaceRootAtom);
  const workspaceGitStatusMap = useAtomValue(workspaceGitStatusMapAtom);
  const activeRepoName =
    activeWorkspaceRoot?.repo?.name ?? activeWorkspaceRoot?.name ?? undefined;

  // Selected state for the branch-switcher row: engaged on click, released
  // when the spotlight closes. The spotlight's own layer state is internal,
  // so a later unrelated spotlight open must not re-highlight the row.
  const spotlightOpen = useAtomValue(spotlightOpenAtom);
  const [branchSwitcherEngaged, setBranchSwitcherEngaged] = useState(false);
  if (branchSwitcherEngaged && !spotlightOpen) {
    // Render-time adjustment instead of an effect (react.dev guidance).
    setBranchSwitcherEngaged(false);
  }
  const branchSwitcherOpen = branchSwitcherEngaged && spotlightOpen;

  const requestNewBrowserSession = useSetAtom(requestNewBrowserSessionAtom);

  /**
   * Collapsed rail keeps the original icon set. The parked rows are only
   * parked from the labelled list: in the 44px column these are pure icon
   * shortcuts with nothing to replace them — the docked terminal cannot open
   * in a column that narrow either.
   */
  const collapsedWorkspaceItems = useMemo<FocusedChatRailItem[]>(
    () => [
      ...workspaceItems,
      {
        key: "terminal",
        label: t("common:tabs.terminal"),
        icon: SquareTerminalIcon,
        shortcutId: "open_terminal_tab",
        onClick: () => void WorkStationViewService.openTerminalTab(),
      },
      {
        key: "files",
        label: t("common:labels.files"),
        icon: FolderClosedIcon,
        shortcutId: "open_file_folder_tab",
        onClick: () => void WorkStationViewService.openFileFolderTab(),
      },
      {
        key: "browser",
        label: t("navigation:labels.browser"),
        icon: InternetIcon,
        onClick: browserTab
          ? () => openWorkstationTab(browserTab.tab)
          : () => {
              openWorkstationHost("browser");
              requestNewBrowserSession({});
            },
      },
    ],
    [
      browserTab,
      openWorkstationHost,
      openWorkstationTab,
      requestNewBrowserSession,
      t,
      workspaceItems,
    ]
  );

  const localEnvironmentLabel = t("navigation:labels.localEnvironment");
  const isMultiWorkspace = workspaceFolders.length > 1;
  const primaryWorkspaceTitle = isMultiWorkspace
    ? (workspaceFolders[0]?.name ?? localEnvironmentLabel)
    : activeRepoName || workspaceFolders[0]?.name || localEnvironmentLabel;

  const workspaceSections = useMemo<FocusedChatRailSection[]>(() => {
    const branchAction: FocusedChatSessionContext["branchAction"] = {
      active: branchSwitcherOpen,
      label: t("common:workstation.switchLocalBranchTooltip"),
      onClick: () => {
        setBranchSwitcherEngaged(true);
        openBranchSpotlight();
      },
    };

    if (!isMultiWorkspace) {
      return [
        {
          ...FOCUSED_CHAT_RAIL_SECTIONS.workspace,
          environment: {
            branchName: activeBranchName,
            branchAction,
          },
          items: workspaceItems,
        },
      ];
    }

    const activePath = activeWorkspaceRoot?.path.replace(/[\\/]+$/u, "");
    return workspaceFolders.map((folder, index) => {
      const folderPath = folder.path.replace(/[\\/]+$/u, "");
      const isActiveFolder = Boolean(
        activeWorkspaceRoot &&
        (activeWorkspaceRoot.id === folder.id ||
          activePath === folderPath ||
          (folder.repoId && activeWorkspaceRoot.repoId === folder.repoId))
      );
      const liveRepoId = folder.repoId ?? folder.id;
      const reviewItem: FocusedChatRailItem = {
        ...workspaceItems[0],
        key: `changes:${folder.id}`,
        workingTreeRepo: { repoId: liveRepoId, repoPath: folder.path },
      };

      return {
        key:
          index === 0
            ? FOCUSED_CHAT_RAIL_SECTIONS.workspace.key
            : secondaryWorkspaceGroupKey(folder.id),
        label: index === 0 ? null : folder.name,
        environment: {
          // The workstation location is shared by the workspace and appears
          // once under its primary root, matching the reference hierarchy.
          environmentKind: index === 0 ? "local" : undefined,
          branchName:
            workspaceGitStatusMap.get(folder.path)?.current_branch ||
            (isActiveFolder ? activeBranchName : undefined),
          branchAction: isActiveFolder ? branchAction : undefined,
        },
        items: [
          reviewItem,
          // Exact-branch GitHub data currently follows the selected repo.
          // Keep it on that root rather than showing another root's links.
          ...(isActiveFolder ? workspaceItems.slice(1) : []),
        ],
      };
    });
  }, [
    activeBranchName,
    activeWorkspaceRoot,
    branchSwitcherOpen,
    isMultiWorkspace,
    t,
    workspaceFolders,
    workspaceGitStatusMap,
    workspaceItems,
  ]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  return {
    collapsedGroupKeys,
    collapsedWorkspaceItems,
    primaryWorkspaceTitle,
    toggleGroup,
    workspaceSections,
  };
}
