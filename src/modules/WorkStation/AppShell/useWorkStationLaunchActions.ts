/**
 * useWorkStationLaunchActions
 *
 * Single source of truth for the WorkStation "launch" actions shared by the
 * empty-pool Launchpad (`WorkStationStartPage`) and the tab-bar `+` dropdown
 * (`TabBarPlusMenu`). Keeping both surfaces on the same ordered list is what
 * guarantees their items and icons stay in sync.
 *
 * Each action opens (or activates) a real `mainPane` tab, except the Browser
 * entries — the Browser host keeps its sessions in a separate store, so those
 * request a session (the Browser host is pre-mounted via `visitedModes`
 * seeding) instead of adding a `mainPane` tab.
 */
import { useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  DeliveryBox01Icon,
  FileDiffIcon,
  FileSearchIcon,
  FolderClosedIcon,
  type IconSvgElement,
  InternetIcon,
  KanbanIcon,
  ListTodoIcon,
  Shield02Icon,
  SquareTerminalIcon,
} from "@src/icons";
import { openEditorSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import {
  CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
  STORY_ORG_SCOPE,
  createExplorerTab,
  createProjectDashboardTab,
  createProjectWorkItemsIndexTab,
  createSearchSessionsTab,
  createSourceControlTab,
  createTerminalTab,
  openTab as openTabMutation,
  requestNewBrowserSessionAtom,
  workstationLayoutAtom,
} from "@src/store/workstation";
import type { WorkStationTab } from "@src/store/workstation/tabs";

export type WorkStationLaunchActionId =
  | "searchFile"
  | "searchSessions"
  | "explorer"
  | "sourceControl"
  | "terminal"
  | "newBrowserTab"
  | "newPrivateBrowserTab"
  | "workItems"
  | "projects";

export type WorkStationLaunchShortcutId =
  | "open_file_folder_tab"
  | "quick_open"
  | "open_source_control_tab"
  | "open_terminal_tab";

const WORKSTATION_LAUNCH_SECTION_IDS = ["primary", "secondary"] as const;

export type WorkStationLaunchSectionId =
  (typeof WORKSTATION_LAUNCH_SECTION_IDS)[number];

export interface WorkStationLaunchAction {
  id: WorkStationLaunchActionId;
  sectionId: WorkStationLaunchSectionId;
  icon: IconSvgElement;
  label: string;
  /** Shortcut registry ID for the keyboard hint, when the action has one. */
  shortcutId?: WorkStationLaunchShortcutId;
  onClick: () => void;
}

export interface WorkStationLaunchSection {
  id: WorkStationLaunchSectionId;
  actions: WorkStationLaunchAction[];
}

/**
 * Projects the shared launch model into its visual sections. Both the My
 * Station launchpad and the tab-bar `+` menu consume this projection so their
 * grouping cannot drift while still allowing either surface to filter items.
 */
export function getWorkStationLaunchSections(
  actions: readonly WorkStationLaunchAction[]
): WorkStationLaunchSection[] {
  return WORKSTATION_LAUNCH_SECTION_IDS.map((id) => ({
    id,
    actions: actions.filter((action) => action.sectionId === id),
  })).filter((section) => section.actions.length > 0);
}

/**
 * Visible launch entries, in display order, shared by the Launchpad and the
 * `+` menu so the two stay in sync. `newPrivateBrowserTab` is intentionally
 * omitted — the private-session feature stays available programmatically (the
 * hook still returns its action); we only hide the entrance.
 */
export const LAUNCHPAD_ACTION_IDS: readonly WorkStationLaunchActionId[] = [
  "explorer",
  "sourceControl",
  "terminal",
  "newBrowserTab",
  "searchFile",
  "searchSessions",
  "workItems",
  "projects",
];

export function useWorkStationLaunchActions(): WorkStationLaunchAction[] {
  const { t } = useTranslation("navigation");
  const requestNewBrowserSession = useSetAtom(requestNewBrowserSessionAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);

  const openTabInMainPane = useCallback(
    (tab: WorkStationTab) => {
      setLayout((prev) => {
        if (!prev?.mainPane) return prev;
        return { ...prev, mainPane: openTabMutation(prev.mainPane, tab) };
      });
    },
    [setLayout]
  );

  const openBrowser = useCallback(
    (isPrivate: boolean) => {
      requestNewBrowserSession(isPrivate ? { isPrivate: true } : {});
    },
    [requestNewBrowserSession]
  );

  return useMemo<WorkStationLaunchAction[]>(
    () => [
      {
        id: "explorer",
        sectionId: "primary",
        icon: FolderClosedIcon,
        label: t("common:labels.files"),
        shortcutId: "open_file_folder_tab",
        onClick: () => openTabInMainPane(createExplorerTab()),
      },
      {
        id: "sourceControl",
        sectionId: "primary",
        icon: FileDiffIcon,
        label: t("common:actions.review"),
        shortcutId: "open_source_control_tab",
        onClick: () =>
          openTabInMainPane(createSourceControlTab(0, { mode: "all-changes" })),
      },
      {
        id: "terminal",
        sectionId: "primary",
        icon: SquareTerminalIcon,
        label: t("common:tabs.terminal"),
        shortcutId: "open_terminal_tab",
        onClick: () =>
          openTabInMainPane(
            createTerminalTab(
              CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
              t("common:tabs.terminal")
            )
          ),
      },
      {
        id: "newBrowserTab",
        sectionId: "primary",
        icon: InternetIcon,
        label: t("labels.browser"),
        onClick: () => openBrowser(false),
      },
      {
        id: "newPrivateBrowserTab",
        sectionId: "primary",
        icon: Shield02Icon,
        label: t("workstation.plusMenu.newPrivateBrowserTab"),
        onClick: () => openBrowser(true),
      },
      {
        id: "searchFile",
        sectionId: "secondary",
        icon: FileSearchIcon,
        label: t("workstation.plusMenu.searchFile"),
        shortcutId: "quick_open",
        onClick: () => openEditorSpotlight(""),
      },
      {
        id: "searchSessions",
        sectionId: "secondary",
        icon: KanbanIcon,
        label: t("workstation.plusMenu.searchSessions"),
        onClick: () => openTabInMainPane(createSearchSessionsTab()),
      },
      {
        id: "workItems",
        sectionId: "secondary",
        icon: ListTodoIcon,
        label: t("workstation.plusMenu.workItems"),
        onClick: () =>
          openTabInMainPane(
            createProjectWorkItemsIndexTab({ orgScope: STORY_ORG_SCOPE.ALL })
          ),
      },
      {
        id: "projects",
        sectionId: "secondary",
        icon: DeliveryBox01Icon,
        label: t("workstation.plusMenu.projects"),
        onClick: () =>
          openTabInMainPane(
            createProjectDashboardTab({ orgScope: STORY_ORG_SCOPE.ALL })
          ),
      },
    ],
    [t, openTabInMainPane, openBrowser]
  );
}
