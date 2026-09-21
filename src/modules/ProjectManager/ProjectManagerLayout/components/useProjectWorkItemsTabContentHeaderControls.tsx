import React, {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";

import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { WorkManagementSearchInput } from "@src/features/GitHubWork/WorkManagementSearchInput";
import type { StatusFilterType } from "@src/modules/ProjectManager/WorkItems/types";
import {
  WORK_ITEMS_KANBAN_GROUP,
  type WorkItemsKanbanGroup,
} from "@src/modules/ProjectManager/WorkItems/workItemsViewModel";
import SplitListFullscreenButton from "@src/scaffold/layouts/SplitListFullscreenButton";

import { STORY_WORK_ITEMS_VISIBLE_TABS } from "./ProjectWorkItemsTabContentConstants";
import type {
  ProjectWorkItemsViewTab,
  WorkspaceSourceMode,
} from "./ProjectWorkItemsTabContentTypes";

interface UseProjectWorkItemsTabContentHeaderControlsParams {
  activeViewTab: ProjectWorkItemsViewTab;
  setActiveViewTab: Dispatch<SetStateAction<ProjectWorkItemsViewTab>>;
  listFullscreen: boolean;
  setListFullscreen: Dispatch<SetStateAction<boolean>>;
  useSplitListHeader: boolean;
  kanbanGroupBy: WorkItemsKanbanGroup;
  setKanbanGroupBy: Dispatch<SetStateAction<WorkItemsKanbanGroup>>;
  allowExternalSources: boolean;
  workspaceSourceMode: WorkspaceSourceMode;
  setWorkspaceSourceMode: (mode: WorkspaceSourceMode) => void;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setStatusFilter: Dispatch<SetStateAction<StatusFilterType>>;
  orgSurfaceControls?: React.ReactNode;
}

/**
 * Header control clusters for the workspace Work Items tab: view / kanban
 * group / source-mode pills, the search box and the fullscreen toggle.
 */
export function useProjectWorkItemsTabContentHeaderControls({
  activeViewTab,
  setActiveViewTab,
  listFullscreen,
  setListFullscreen,
  useSplitListHeader,
  kanbanGroupBy,
  setKanbanGroupBy,
  allowExternalSources,
  workspaceSourceMode,
  setWorkspaceSourceMode,
  searchQuery,
  setSearchQuery,
  setStatusFilter,
  orgSurfaceControls,
}: UseProjectWorkItemsTabContentHeaderControlsParams) {
  const { t } = useTranslation("projects");

  const workspaceSourceTabs = useMemo<TabPillItem[]>(
    () => [
      { key: "local_only", label: t("projects.source.localOnly") },
      {
        key: "include_external",
        label: t("projects.source.includeExternal"),
      },
    ],
    [t]
  );

  const workItemsViewTabs = useMemo<TabPillItem[]>(
    () =>
      STORY_WORK_ITEMS_VISIBLE_TABS.map((tab) => ({
        key: tab,
        label: t(`workItems.tabs.${tab === "List" ? "list" : "kanban"}`),
      })),
    [t]
  );
  const kanbanGroupTabs = useMemo<TabPillItem[]>(
    () => [
      {
        key: WORK_ITEMS_KANBAN_GROUP.STATUS,
        label: t("projects.groupBy.status"),
      },
      {
        key: WORK_ITEMS_KANBAN_GROUP.ASSIGNED_TO,
        label: t("projects.groupBy.assignedTo"),
      },
      {
        key: WORK_ITEMS_KANBAN_GROUP.CREATED_BY,
        label: t("projects.groupBy.createdBy"),
      },
    ],
    [t]
  );

  const handleWorkItemsViewChange = useCallback(
    (key: string) => {
      if (key === "List" || key === "Kanban") {
        setActiveViewTab(key);
        if (key !== "List") setListFullscreen(false);
      }
    },
    [setActiveViewTab, setListFullscreen]
  );

  const workItemsViewSwitch = useMemo(
    () => (
      <TabPill
        tabs={workItemsViewTabs}
        activeTab={activeViewTab}
        onChange={handleWorkItemsViewChange}
        variant="pill"
        color="fill"
        fillWidth={false}
        size="small"
      />
    ),
    [activeViewTab, handleWorkItemsViewChange, workItemsViewTabs]
  );

  const kanbanGroupSwitch = useMemo(() => {
    if (activeViewTab !== "Kanban") return null;
    return (
      <TabPill
        tabs={kanbanGroupTabs}
        activeTab={kanbanGroupBy}
        onChange={(key) => setKanbanGroupBy(key as WorkItemsKanbanGroup)}
        variant="pill"
        color="fill"
        fillWidth={false}
        size="small"
      />
    );
  }, [activeViewTab, kanbanGroupBy, kanbanGroupTabs, setKanbanGroupBy]);

  const handleWorkspaceSourceModeChange = useCallback(
    (key: string) => {
      setWorkspaceSourceMode(key as WorkspaceSourceMode);
    },
    [setWorkspaceSourceMode]
  );

  const sourceModeSwitch = useMemo(() => {
    if (!allowExternalSources) return null;
    return (
      <TabPill
        tabs={workspaceSourceTabs}
        activeTab={workspaceSourceMode}
        onChange={handleWorkspaceSourceModeChange}
        variant="pill"
        color="fill"
        fillWidth={false}
        size="small"
      />
    );
  }, [
    allowExternalSources,
    handleWorkspaceSourceModeChange,
    workspaceSourceMode,
    workspaceSourceTabs,
  ]);

  const headerLeadingControls = useMemo(
    () => (
      <div className="contents">
        {orgSurfaceControls}
        {orgSurfaceControls && <HeaderSectionSeparator />}
        {workItemsViewSwitch}
        {kanbanGroupSwitch && <HeaderSectionSeparator />}
        {kanbanGroupSwitch}
        {sourceModeSwitch && <HeaderSectionSeparator />}
        {sourceModeSwitch}
      </div>
    ),
    [
      kanbanGroupSwitch,
      orgSurfaceControls,
      sourceModeSwitch,
      workItemsViewSwitch,
    ]
  );
  const headerTrailingControls = useMemo(
    () => (
      <div
        className={`flex min-w-0 items-center gap-px overflow-visible ${
          useSplitListHeader ? "flex-1" : ""
        }`.trim()}
      >
        <WorkManagementSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          fillWidth={useSplitListHeader}
          dataTestId="workspace-work-items-search"
        />
      </div>
    ),
    [searchQuery, setSearchQuery, useSplitListHeader]
  );
  const headerEndControls = useMemo(
    () =>
      activeViewTab === "List" ? (
        <SplitListFullscreenButton
          isFullscreen={listFullscreen}
          onToggle={() => setListFullscreen((current) => !current)}
        />
      ) : null,
    [activeViewTab, listFullscreen, setListFullscreen]
  );
  const handleStatusFilterChange = useCallback(
    (value: string) => setStatusFilter(value as StatusFilterType),
    [setStatusFilter]
  );

  return {
    headerLeadingControls,
    headerTrailingControls,
    headerEndControls,
    handleStatusFilterChange,
  };
}
