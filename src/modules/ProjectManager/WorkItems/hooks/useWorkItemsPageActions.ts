import { type Dispatch, type SetStateAction, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  PROJECT_DETAIL_SURFACE_VIEW,
  type ProjectDetailSurfaceView,
} from "@src/store/workstation/tabs";
import type { WorkItem } from "@src/types/core/workItem";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import type { StatusFilterType, WorkItemsViewTab } from "../types";
import type { useWorkItems } from "./useWorkItems";

type WorkItemsPage = ReturnType<typeof useWorkItems>;

interface UseWorkItemsPageActionsParams {
  handlers: WorkItemsPage["handlers"];
  activeTab: WorkItemsViewTab;
  workItems: WorkItemsPage["data"]["workItems"];
  selectedWorkItem: WorkItemsPage["data"]["selectedWorkItem"];
  setStatusFilter: (filter: StatusFilterType) => void;
  setListFullscreen: Dispatch<SetStateAction<boolean>>;
  setCollapseAllSignal: Dispatch<SetStateAction<number>>;
  setHasWorkItemPendingChanges: Dispatch<SetStateAction<boolean>>;
  onProjectViewChange?: (view: ProjectDetailSurfaceView) => void;
  onExpandWorkItemToTab?: (
    workItemId: string,
    workItemName: string,
    pendingUpdates?: Record<string, unknown>,
    workItemStatus?: string,
    workItem?: WorkItem
  ) => void;
}

/**
 * Stable page-level handlers for the Work Items page: tab / surface switching,
 * selection, detail open/close and confirmed deletes.
 */
export function useWorkItemsPageActions({
  handlers,
  activeTab,
  workItems,
  selectedWorkItem,
  setStatusFilter,
  setListFullscreen,
  setCollapseAllSignal,
  setHasWorkItemPendingChanges,
  onProjectViewChange,
  onExpandWorkItemToTab,
}: UseWorkItemsPageActionsParams) {
  const { t } = useTranslation("projects");
  const { handleTabChange } = handlers;

  const handleWorkItemsTabChange = useCallback(
    (tab: WorkItemsViewTab) => {
      if (tab !== "List" || activeTab !== "List") {
        setListFullscreen(false);
      }
      handleTabChange(tab);
    },
    [handleTabChange, activeTab, setListFullscreen]
  );

  const confirmWorkItemDelete = useCallback(
    async (name?: string) =>
      confirmDestructiveAction({
        title: name
          ? t("common:actions.confirmDeleteTitle", { name })
          : t("common:actions.confirmDelete"),
        message: t("common:actions.confirmDeleteMessage"),
        okLabel: t("common:actions.delete"),
        cancelLabel: t("common:actions.cancel"),
      }),
    [t]
  );
  const handleDeleteWorkItem = useCallback(
    async (workItemId: string) => {
      const item = workItems.find(
        (candidate) => candidate.session_id === workItemId
      );
      if (!(await confirmWorkItemDelete(item?.name))) return;
      await handlers.handleDelete(workItemId);
    },
    [confirmWorkItemDelete, workItems, handlers]
  );

  const handleOpenWorkItem = useCallback(
    (workItemId: string) => {
      // A selection from the full-width List view must reveal its detail.
      setListFullscreen(false);
      handlers.handleSelect(workItemId);
    },
    [handlers, setListFullscreen]
  );

  const handleCollapseAll = useCallback(() => {
    setCollapseAllSignal((currentSignal) => currentSignal + 1);
  }, [setCollapseAllSignal]);

  const handleCloseDetail = useCallback(() => {
    handlers.handleCloseWorkItemDetail();
    setHasWorkItemPendingChanges(false);
  }, [handlers, setHasWorkItemPendingChanges]);

  const handleOpenSelectedWorkItemInNewTab = useCallback(() => {
    const workItem = selectedWorkItem;
    if (!workItem || !onExpandWorkItemToTab) return;
    onExpandWorkItemToTab(
      workItem.session_id,
      workItem.name || t("common:placeholders.untitled"),
      undefined,
      workItem.workItemStatus ?? workItem.status,
      workItem
    );
  }, [selectedWorkItem, onExpandWorkItemToTab, t]);

  const handleProjectViewChange = useCallback(
    (nextProjectView: ProjectDetailSurfaceView) => {
      onProjectViewChange?.(nextProjectView);
      handleWorkItemsTabChange(
        nextProjectView === PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
          ? "Overview"
          : "List"
      );
    },
    [handleWorkItemsTabChange, onProjectViewChange]
  );

  const handleHeaderTabChange = useCallback(
    (nextTab: WorkItemsViewTab) => {
      onProjectViewChange?.(
        nextTab === "Overview"
          ? PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
          : PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS
      );
      handleWorkItemsTabChange(nextTab);
    },
    [handleWorkItemsTabChange, onProjectViewChange]
  );

  const handleStatusFilterChange = useCallback(
    (value: string) => setStatusFilter(value as StatusFilterType),
    [setStatusFilter]
  );

  return {
    confirmWorkItemDelete,
    handleDeleteWorkItem,
    handleOpenWorkItem,
    handleCollapseAll,
    handleCloseDetail,
    handleOpenSelectedWorkItemInNewTab,
    handleProjectViewChange,
    handleHeaderTabChange,
    handleStatusFilterChange,
  };
}
