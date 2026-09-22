import React from "react";
import { useTranslation } from "react-i18next";

import type { MemberEntry } from "@src/api/http/project";
import { Placeholder } from "@src/components/Placeholder";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  WorkManagementTable,
  type WorkManagementTableRow,
} from "@src/features/GitHubWork/WorkManagementTable";
import { HugeiconsIcon, ListTodoIcon } from "@src/icons";
import { WORK_ITEMS_KANBAN_GROUP } from "@src/modules/ProjectManager/WorkItems/workItemsViewModel";
import type { WorkItemsKanbanGroup } from "@src/modules/ProjectManager/WorkItems/workItemsViewModel";
import type { ProjectManagerBreadcrumbSegment } from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import { PROJECT_MANAGER_PLACEHOLDER_PLACEMENT } from "@src/modules/ProjectManager/shared/placeholderTokens";
import DetailPaneLayout, {
  DetailPanePlaceholder,
} from "@src/scaffold/layouts/DetailPaneLayout";

import type {
  AggregatedWorkItem,
  ProjectWorkItemSelection,
  ProjectWorkItemsViewTab,
} from "./ProjectWorkItemsTabContentTypes";
import { toProjectWorkItemSelection } from "./projectWorkItemSelection";
import type { useProjectWorkItemsTabContentInteractions } from "./useProjectWorkItemsTabContentInteractions";
import type { useProjectWorkItemsTabContentWorkspaceData } from "./useProjectWorkItemsTabContentWorkspaceData";

const KanbanBoard = React.lazy(() => import("@src/features/KanbanBoard"));
const WorkItemDetail = React.lazy(
  () =>
    import("@src/modules/ProjectManager/WorkItems/components/WorkItemDetail")
);

type ProjectWorkItemsInteractions = ReturnType<
  typeof useProjectWorkItemsTabContentInteractions
>;
type ProjectWorkItemsWorkspaceData = ReturnType<
  typeof useProjectWorkItemsTabContentWorkspaceData
>;

interface ProjectWorkItemsListPaneProps {
  showInitialLoading: boolean;
  showInitialError: boolean;
  error: ProjectWorkItemsWorkspaceData["error"];
  activeViewTab: ProjectWorkItemsViewTab;
  kanbanTasks: ProjectWorkItemsInteractions["kanbanTasks"];
  kanbanColumns: ProjectWorkItemsInteractions["kanbanColumns"];
  kanbanGroupBy: WorkItemsKanbanGroup;
  handleKanbanTaskMove: ProjectWorkItemsInteractions["handleKanbanTaskMove"];
  handleKanbanTaskClick: ProjectWorkItemsInteractions["handleKanbanTaskClick"];
  handleAddKanbanTask: ProjectWorkItemsInteractions["handleAddKanbanTask"];
  handleRefresh: ProjectWorkItemsInteractions["handleRefresh"];
  onCreateWorkItem?: () => void;
  settingsRows: WorkManagementTableRow[];
  completedStatusSelected: boolean;
  completedItemsLoading: boolean;
  completedItemsError: ProjectWorkItemsWorkspaceData["completedItemsError"];
  loadCompletedWorkItems: ProjectWorkItemsWorkspaceData["loadCompletedWorkItems"];
  workItemCount: number;
}

/** Full-width list surface: loading / error placeholders, Kanban board or table. */
export const ProjectWorkItemsListPane: React.FC<
  ProjectWorkItemsListPaneProps
> = ({
  showInitialLoading,
  showInitialError,
  error,
  activeViewTab,
  kanbanTasks,
  kanbanColumns,
  kanbanGroupBy,
  handleKanbanTaskMove,
  handleKanbanTaskClick,
  handleAddKanbanTask,
  handleRefresh,
  onCreateWorkItem,
  settingsRows,
  completedStatusSelected,
  completedItemsLoading,
  completedItemsError,
  loadCompletedWorkItems,
  workItemCount,
}) => {
  const { t } = useTranslation("projects");

  return showInitialLoading ? (
    <Placeholder
      variant="loading"
      placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
      title={t("projects.loading")}
      fillParentHeight
    />
  ) : showInitialError ? (
    <Placeholder
      variant="error"
      placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
      title={error ?? ""}
      onRetry={handleRefresh}
      fillParentHeight
    />
  ) : activeViewTab === "Kanban" ? (
    <div className="h-full min-h-0">
      <React.Suspense
        fallback={<Placeholder variant="loading" fillParentHeight />}
      >
        <KanbanBoard
          tasks={kanbanTasks}
          columnOrder={kanbanColumns}
          allowColumnReorder={false}
          allowTaskDrag={kanbanGroupBy === WORK_ITEMS_KANBAN_GROUP.STATUS}
          onTaskMove={handleKanbanTaskMove}
          onTaskClick={handleKanbanTaskClick}
          onAddTask={handleAddKanbanTask}
          showAddButton={
            kanbanGroupBy === WORK_ITEMS_KANBAN_GROUP.STATUS &&
            Boolean(onCreateWorkItem)
          }
          className="kanban-board--linear"
        />
      </React.Suspense>
    </div>
  ) : (
    <WorkManagementTable
      rows={settingsRows}
      pageSize={25}
      pageSizeOptions={[10, 25, 50, 100]}
      loading={completedStatusSelected && completedItemsLoading}
      testId="workspace-work-items-table"
      noDataElement={
        completedStatusSelected && completedItemsLoading ? (
          <Placeholder
            variant="loading"
            placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
            title={t("projects.loading")}
            fillParentHeight
          />
        ) : completedStatusSelected && completedItemsError ? (
          <Placeholder
            variant="error"
            placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
            title={completedItemsError}
            onRetry={() => void loadCompletedWorkItems()}
            fillParentHeight
          />
        ) : workItemCount === 0 ? (
          <Placeholder
            variant="empty"
            placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
            title={t("workItems.noWorkItems")}
            subtitle={t("workItems.noWorkItemsSubtitle")}
            action={
              onCreateWorkItem
                ? {
                    label: t("workItems.addFirstWorkItem"),
                    onClick: onCreateWorkItem,
                  }
                : undefined
            }
            fillParentHeight
          />
        ) : (
          <Placeholder
            variant="no-results"
            placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
            title={t("workItems.noResults")}
            fillParentHeight
          />
        )
      }
    />
  );
};

interface ProjectWorkItemsDetailPaneProps {
  selectedWorkItem: AggregatedWorkItem | null;
  handleCloseDetail: () => void;
  onOpenWorkItem: (selection: ProjectWorkItemSelection) => void;
  handleDetailNavigate: (direction: "prev" | "next") => void;
  selectedDetailIndex: number;
  visibleDetailCount: number;
  handleUpdateWorkItem: ProjectWorkItemsInteractions["handleUpdateWorkItem"];
  projectOptions: ProjectWorkItemsWorkspaceData["projectOptions"];
  workItemPeople: MemberEntry[];
  breadcrumbSegments?: readonly ProjectManagerBreadcrumbSegment[];
}

/** Right-hand detail pane: the lazily loaded WorkItemDetail or an empty placeholder. */
export const ProjectWorkItemsDetailPane: React.FC<
  ProjectWorkItemsDetailPaneProps
> = ({
  selectedWorkItem,
  handleCloseDetail,
  onOpenWorkItem,
  handleDetailNavigate,
  selectedDetailIndex,
  visibleDetailCount,
  handleUpdateWorkItem,
  projectOptions,
  workItemPeople,
  breadcrumbSegments,
}) => {
  const { t } = useTranslation("projects");

  return selectedWorkItem ? (
    <React.Suspense
      fallback={
        <DetailPaneLayout
          onClose={handleCloseDetail}
          closeTestId="work-item-close-detail"
        >
          <DetailPanePlaceholder variant="loading" />
        </DetailPaneLayout>
      }
    >
      <WorkItemDetail
        workItem={selectedWorkItem.item}
        onClose={handleCloseDetail}
        onOpenInNewTab={() =>
          onOpenWorkItem(toProjectWorkItemSelection(selectedWorkItem))
        }
        onNavigate={handleDetailNavigate}
        hasPrev={selectedDetailIndex > 0}
        hasNext={
          selectedDetailIndex >= 0 &&
          selectedDetailIndex < visibleDetailCount - 1
        }
        onUpdateWorkItem={(updates) =>
          handleUpdateWorkItem(selectedWorkItem.item.session_id, updates)
        }
        availableProjects={projectOptions.map(({ id, name }) => ({ id, name }))}
        availableMembers={workItemPeople}
        projectSlug={selectedWorkItem.project?.slug}
        orgId={selectedWorkItem.orgId}
        shortId={selectedWorkItem.shortId}
        breadcrumbSegments={breadcrumbSegments}
        breadcrumbProjectName={
          selectedWorkItem.project?.meta.name ?? t("projects.columns.workItems")
        }
        breadcrumbIcon={
          <HugeiconsIcon
            icon={ListTodoIcon}
            data-icon="list-todo"
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={1.75}
          />
        }
      />
    </React.Suspense>
  ) : (
    <DetailPaneLayout>
      <DetailPanePlaceholder
        variant="empty"
        title={t("common:teamInbox.empty.selectTitle")}
        subtitle={t("common:teamInbox.empty.selectSubtitle")}
      />
    </DetailPaneLayout>
  );
};
