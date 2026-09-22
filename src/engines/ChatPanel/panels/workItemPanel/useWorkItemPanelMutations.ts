import { emit } from "@tauri-apps/api/event";
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  enrichedWorkItemToUI,
  projectApi,
  standaloneWorkItemDataToEnriched,
} from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import { toWorkItemPartialUpdate } from "@src/modules/ProjectManager/WorkItems/workItemPartialUpdate";
import { closeWorkItemChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  type ChatPanelSelectedWorkItem,
  updateChatPanelWorkItemTabAtom,
} from "@src/store/ui/chatPanel/selectionAtoms";
import type { Person } from "@src/types/core/shared";
import type { WorkItem } from "@src/types/core/workItem";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

const logger = createLogger("WorkItemPanelView");

interface UseWorkItemPanelMutationsArgs {
  selectedWorkItem: ChatPanelSelectedWorkItem;
  onUpdateWorkItem?: (updates: Partial<WorkItem>) => void;
  currentUser: Person | null;
  handleRevisionConflict: (
    error: unknown,
    attempt: Partial<WorkItem>
  ) => Promise<boolean>;
  t: TFunction;
}

/** Update, refresh and delete flows for the chat-panel work item tab. */
export function useWorkItemPanelMutations({
  selectedWorkItem,
  onUpdateWorkItem,
  currentUser,
  handleRevisionConflict,
  t,
}: UseWorkItemPanelMutationsArgs) {
  const closeWorkItemTab = useSetAtom(closeWorkItemChatPanelTabAtom);
  const updateWorkItemTab = useSetAtom(updateChatPanelWorkItemTabAtom);

  const handleUpdateWorkItem = useCallback(
    async (updates: Partial<WorkItem>) => {
      if (onUpdateWorkItem) {
        onUpdateWorkItem(updates);
        return;
      }

      try {
        const payload = toWorkItemPartialUpdate(updates, currentUser);
        if (Object.keys(payload).length === 0) return;

        if (selectedWorkItem.projectSlug) {
          const updatedWorkItem = enrichedWorkItemToUI(
            await projectApi.updateWorkItemPartial(
              selectedWorkItem.projectSlug,
              selectedWorkItem.shortId,
              payload,
              selectedWorkItem.workItem.revision
            )
          );
          updateWorkItemTab({
            ...selectedWorkItem,
            workItem: updatedWorkItem,
          });
        } else {
          // Atomic partial update, kept under the owning org — an orgless
          // whole-row write would re-home a collab-org item to
          // personal-org and detach it from sync, and a client-side merge
          // could silently drop concurrent edits.
          const updatedWorkItem = enrichedWorkItemToUI(
            standaloneWorkItemDataToEnriched(
              await projectApi.updateStandaloneWorkItemPartial(
                selectedWorkItem.shortId,
                payload,
                selectedWorkItem.orgId
                  ? { orgId: selectedWorkItem.orgId }
                  : undefined,
                selectedWorkItem.workItem.revision
              )
            )
          );
          updateWorkItemTab({
            ...selectedWorkItem,
            workItem: updatedWorkItem,
          });
        }
        await emit("orgii-data-changed", {
          project_slug: selectedWorkItem.projectSlug || undefined,
          work_item_id: selectedWorkItem.shortId,
          source: "chat-panel-work-item-update",
        });
      } catch (error) {
        logger.error("Failed to update chat panel work item", error);
        await handleRevisionConflict(error, updates);
      }
    },
    [
      currentUser,
      handleRevisionConflict,
      onUpdateWorkItem,
      selectedWorkItem,
      updateWorkItemTab,
    ]
  );

  // The selection atom reads and updates the owning tab directly. Refresh
  // uses a functional update so a late response cannot replace a newly
  // selected item. No render effect or second payload copy is involved.
  const refreshSelectedWorkItemOnce = useCallback(async () => {
    try {
      if (selectedWorkItem.projectSlug) {
        const fresh = await projectApi.readWorkItemEnriched(
          selectedWorkItem.projectSlug,
          selectedWorkItem.shortId,
          selectedWorkItem.orgId ? { orgId: selectedWorkItem.orgId } : undefined
        );
        if (fresh.deletedAt) {
          // A collaborator may delete the item itself or its parent project
          // while this detail is open. Enriched reads intentionally retain
          // soft-deleted rows, so a tombstone must be treated as absent too;
          // otherwise the sidebar disappears while an editable ghost remains.
          closeWorkItemTab(selectedWorkItem);
          return;
        }
        const refreshedProjectItem = enrichedWorkItemToUI(fresh);
        updateWorkItemTab((current) =>
          current?.projectSlug === selectedWorkItem.projectSlug &&
          current.shortId === selectedWorkItem.shortId &&
          current.orgId === selectedWorkItem.orgId
            ? { ...current, workItem: refreshedProjectItem }
            : current
        );
        return;
      }
      if (!selectedWorkItem.shortId) return;
      const data = await projectApi.readStandaloneWorkItem(
        selectedWorkItem.shortId,
        selectedWorkItem.orgId ? { orgId: selectedWorkItem.orgId } : undefined
      );
      const refreshedStandaloneItem = enrichedWorkItemToUI(
        standaloneWorkItemDataToEnriched(data)
      );
      updateWorkItemTab((current) =>
        current?.shortId === selectedWorkItem.shortId &&
        current.orgId === selectedWorkItem.orgId
          ? { ...current, workItem: refreshedStandaloneItem }
          : current
      );
    } catch (error) {
      if (String(error).toLowerCase().includes("not found")) {
        // The single-item command resolves both the parent and item at the
        // authoritative SQLite boundary. Either tombstone makes this cached
        // tab invalid, without scanning every project and every work item.
        closeWorkItemTab(selectedWorkItem);
        return;
      }
      logger.warn("Failed to refresh chat panel work item", error);
    }
  }, [closeWorkItemTab, selectedWorkItem, updateWorkItemTab]);

  const refreshOnceRef = useRef(refreshSelectedWorkItemOnce);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    refreshOnceRef.current = refreshSelectedWorkItemOnce;
  }, [refreshSelectedWorkItemOnce]);

  const refreshSelectedWorkItem = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const request = refreshOnceRef.current().finally(() => {
      if (refreshInFlightRef.current === request) {
        refreshInFlightRef.current = null;
      }
    });
    refreshInFlightRef.current = request;
    return request;
  }, []);

  const handleDeleteWorkItem = useCallback(async () => {
    if (!selectedWorkItem.projectSlug) return;

    const confirmed = await confirmDestructiveAction({
      title: t("common:actions.confirmDeleteTitle", {
        name: selectedWorkItem.workItem.name,
      }),
      message: t("common:actions.confirmDeleteMessage"),
      okLabel: t("common:actions.delete"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;

    try {
      await projectApi.deleteWorkItem(
        selectedWorkItem.projectSlug,
        selectedWorkItem.shortId
      );
      // The tab payload owns this surface. Clearing only the legacy selection
      // mirror leaves the deleted detail mounted until another data-change
      // refresh happens, and a later cascade can fall back to that ghost tab.
      closeWorkItemTab(selectedWorkItem);
      await emit("orgii-data-changed", {
        project_slug: selectedWorkItem.projectSlug,
        work_item_id: selectedWorkItem.shortId,
        source: "chat-panel-work-item-delete",
      });
    } catch (error) {
      logger.error("Failed to delete chat panel work item", error);
    }
  }, [closeWorkItemTab, selectedWorkItem, t]);

  return {
    handleUpdateWorkItem,
    refreshSelectedWorkItem,
    handleDeleteWorkItem,
  };
}
