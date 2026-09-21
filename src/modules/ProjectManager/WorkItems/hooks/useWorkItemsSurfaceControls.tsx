import React, { type Dispatch, type SetStateAction, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { WorkManagementSearchInput } from "@src/features/GitHubWork/WorkManagementSearchInput";
import SplitListFullscreenButton from "@src/scaffold/layouts/SplitListFullscreenButton";
import type { ProjectDetailSurfaceView } from "@src/store/workstation/tabs";
import type { Person } from "@src/types/core/shared";

import { ProjectDetailSurfacePillSwitch } from "../../ProjectManagerLayout/components/ProjectDetailSurfacePillSwitch";
import PropertyFilterControl from "../components/PropertyFilterControl";
import type { WorkItemPropertyFilter } from "../propertyViewModel";
import type { WorkItemsViewTab } from "../types";
import {
  WORK_ITEMS_KANBAN_GROUP,
  type WorkItemsKanbanGroup,
} from "../workItemsViewModel";
import type { useWorkItemPropertyView } from "./useWorkItemPropertyView";
import type { useWorkItems } from "./useWorkItems";

export const WORK_ITEMS_VIEW_TABS: readonly WorkItemsViewTab[] = [
  "List",
  "Table",
  "Kanban",
  "Gantt",
  "Calendar",
];

interface UseWorkItemsSurfaceControlsParams {
  state: ReturnType<typeof useWorkItems>["state"];
  activeProjectView: ProjectDetailSurfaceView;
  isWorkItemsSurface: boolean;
  useSplitListHeader: boolean;
  handleProjectViewChange: (nextProjectView: ProjectDetailSurfaceView) => void;
  handleHeaderTabChange: (nextTab: WorkItemsViewTab) => void;
  kanbanGroupBy: WorkItemsKanbanGroup;
  setKanbanGroupBy: Dispatch<SetStateAction<WorkItemsKanbanGroup>>;
  listFullscreen: boolean;
  setListFullscreen: Dispatch<SetStateAction<boolean>>;
  propertyView: ReturnType<typeof useWorkItemPropertyView>;
  availablePropertyIds: ReadonlySet<string>;
  propertyFilterPropertyId: string | null;
  applicablePropertyFilter: WorkItemPropertyFilter | null;
  applicablePropertyGroupBy: string | null;
  handlePropertyFilterPropertyChange: (
    selectedPropertyId: string | null
  ) => void;
  handlePropertyFilterChange: (filter: WorkItemPropertyFilter | null) => void;
  handlePropertyGroupByChange: (groupBy: string | null) => void;
  availableMembers: Person[];
  savedViewsControl: React.ReactNode;
}

/**
 * Header control clusters for the Work Items page: surface / view / kanban
 * group pills, property filter, search box and the split-list fullscreen toggle.
 */
export function useWorkItemsSurfaceControls({
  state,
  activeProjectView,
  isWorkItemsSurface,
  useSplitListHeader,
  handleProjectViewChange,
  handleHeaderTabChange,
  kanbanGroupBy,
  setKanbanGroupBy,
  listFullscreen,
  setListFullscreen,
  propertyView,
  availablePropertyIds,
  propertyFilterPropertyId,
  applicablePropertyFilter,
  applicablePropertyGroupBy,
  handlePropertyFilterPropertyChange,
  handlePropertyFilterChange,
  handlePropertyGroupByChange,
  availableMembers,
  savedViewsControl,
}: UseWorkItemsSurfaceControlsParams) {
  const { t } = useTranslation("projects");

  const workItemsViewTabs = useMemo<TabPillItem[]>(
    () =>
      WORK_ITEMS_VIEW_TABS.map((tab) => ({
        key: tab,
        label: t(`workItems.tabs.${tab.toLowerCase()}`),
        dataTestId: `work-items-view-tab-${tab.toLowerCase()}`,
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
      {
        key: WORK_ITEMS_KANBAN_GROUP.PROJECT,
        label: t("projects.groupBy.project"),
      },
      {
        key: WORK_ITEMS_KANBAN_GROUP.PROPERTY,
        label: t("projects.groupBy.property"),
      },
    ],
    [t]
  );

  const projectSurfaceControls = useMemo(
    () => (
      <div className="flex min-w-0 items-center gap-1.5">
        <ProjectDetailSurfacePillSwitch
          projectView={activeProjectView}
          onProjectViewChange={handleProjectViewChange}
        />
        {isWorkItemsSurface && (
          <>
            <span className="text-xs text-text-4">/</span>
            <TabPill
              tabs={workItemsViewTabs}
              activeTab={state.activeTab}
              onChange={(key) => handleHeaderTabChange(key as WorkItemsViewTab)}
              variant="pill"
              color="fill"
              fillWidth={false}
              size="small"
            />
            {state.activeTab === "Kanban" && (
              <>
                <span className="text-xs text-text-4">/</span>
                <TabPill
                  tabs={kanbanGroupTabs}
                  activeTab={kanbanGroupBy}
                  onChange={(key) =>
                    setKanbanGroupBy(key as WorkItemsKanbanGroup)
                  }
                  variant="pill"
                  color="fill"
                  fillWidth={false}
                  size="small"
                />
                {kanbanGroupBy === WORK_ITEMS_KANBAN_GROUP.PROPERTY && (
                  <Select
                    value={applicablePropertyGroupBy ?? undefined}
                    options={propertyView.definitions.map((definition) => ({
                      value: definition.id,
                      label: definition.name,
                    }))}
                    onChange={(value) =>
                      handlePropertyGroupByChange(String(value))
                    }
                    onClear={() => handlePropertyGroupByChange(null)}
                    allowClear
                    showSearch
                    appearance="ghost"
                    size="small"
                    placeholder={t("workItems.table.groupByProperty", {
                      defaultValue: "Group by property",
                    })}
                    ariaLabel={t("workItems.table.groupByProperty", {
                      defaultValue: "Group by property",
                    })}
                    dataTestId="work-items-kanban-property-group"
                  />
                )}
              </>
            )}
            {savedViewsControl}
            <PropertyFilterControl
              definitions={propertyView.definitions}
              values={propertyView.values}
              members={availableMembers}
              selectedPropertyId={
                propertyView.ready &&
                propertyFilterPropertyId &&
                availablePropertyIds.has(propertyFilterPropertyId)
                  ? propertyFilterPropertyId
                  : null
              }
              filter={applicablePropertyFilter}
              onSelectedPropertyIdChange={handlePropertyFilterPropertyChange}
              onFilterChange={handlePropertyFilterChange}
            />
          </>
        )}
      </div>
    ),
    [
      activeProjectView,
      handleHeaderTabChange,
      handleProjectViewChange,
      isWorkItemsSurface,
      kanbanGroupBy,
      kanbanGroupTabs,
      availableMembers,
      applicablePropertyFilter,
      applicablePropertyGroupBy,
      availablePropertyIds,
      handlePropertyFilterChange,
      handlePropertyFilterPropertyChange,
      handlePropertyGroupByChange,
      propertyFilterPropertyId,
      propertyView.definitions,
      propertyView.ready,
      propertyView.values,
      savedViewsControl,
      setKanbanGroupBy,
      state.activeTab,
      t,
      workItemsViewTabs,
    ]
  );
  const workItemsSearchControl = useMemo(
    () =>
      isWorkItemsSurface && state.activeTab !== "Settings" ? (
        <div
          className={`flex min-w-0 items-center gap-px ${
            useSplitListHeader ? "flex-1" : ""
          }`.trim()}
        >
          <WorkManagementSearchInput
            value={state.searchQuery}
            onChange={state.setSearchQuery}
            fillWidth={useSplitListHeader}
            dataTestId="project-work-items-search"
          />
        </div>
      ) : null,
    [
      isWorkItemsSurface,
      state.activeTab,
      state.searchQuery,
      state.setSearchQuery,
      useSplitListHeader,
    ]
  );
  const workItemsEndControl = useMemo(
    () =>
      isWorkItemsSurface && state.activeTab === "List" ? (
        <SplitListFullscreenButton
          isFullscreen={listFullscreen}
          onToggle={() => setListFullscreen((current) => !current)}
        />
      ) : null,
    [isWorkItemsSurface, listFullscreen, setListFullscreen, state.activeTab]
  );

  return {
    projectSurfaceControls,
    workItemsSearchControl,
    workItemsEndControl,
  };
}
