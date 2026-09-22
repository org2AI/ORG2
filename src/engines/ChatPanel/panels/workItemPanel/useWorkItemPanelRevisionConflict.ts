import { emit } from "@tauri-apps/api/event";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  enrichedWorkItemToUI,
  projectApi,
  standaloneWorkItemDataToEnriched,
} from "@src/api/http/project";
import { useWorkItemRevisionConflict } from "@src/modules/ProjectManager/WorkItems/hooks/useWorkItemRevisionConflict";
import { toWorkItemPartialUpdate } from "@src/modules/ProjectManager/WorkItems/workItemPartialUpdate";
import {
  type ChatPanelSelectedWorkItem,
  updateChatPanelWorkItemTabAtom,
} from "@src/store/ui/chatPanel/selectionAtoms";
import type { Person } from "@src/types/core/shared";
import type { WorkItem } from "@src/types/core/workItem";

interface UseWorkItemPanelRevisionConflictArgs {
  selectedWorkItem: ChatPanelSelectedWorkItem;
  currentUser: Person | null;
}

/** Revision-conflict reload/retry wiring for the chat-panel work item tab. */
export function useWorkItemPanelRevisionConflict({
  selectedWorkItem,
  currentUser,
}: UseWorkItemPanelRevisionConflictArgs) {
  const updateWorkItemTab = useSetAtom(updateChatPanelWorkItemTabAtom);

  const readLatestSelectedWorkItem =
    useCallback(async (): Promise<WorkItem> => {
      if (selectedWorkItem.projectSlug) {
        return enrichedWorkItemToUI(
          await projectApi.readWorkItemEnriched(
            selectedWorkItem.projectSlug,
            selectedWorkItem.shortId,
            selectedWorkItem.orgId
              ? { orgId: selectedWorkItem.orgId }
              : undefined
          )
        );
      }
      return enrichedWorkItemToUI(
        standaloneWorkItemDataToEnriched(
          await projectApi.readStandaloneWorkItem(
            selectedWorkItem.shortId,
            selectedWorkItem.orgId
              ? { orgId: selectedWorkItem.orgId }
              : undefined
          )
        )
      );
    }, [
      selectedWorkItem.orgId,
      selectedWorkItem.projectSlug,
      selectedWorkItem.shortId,
    ]);

  const acceptRevisionRecord = useCallback(
    (record: WorkItem) => {
      updateWorkItemTab((current) =>
        current?.shortId === selectedWorkItem.shortId &&
        current.orgId === selectedWorkItem.orgId
          ? { ...current, workItem: record }
          : current
      );
    },
    [selectedWorkItem.orgId, selectedWorkItem.shortId, updateWorkItemTab]
  );
  const retryRevisionUpdate = useCallback(
    async (updates: Partial<WorkItem>, expectedRevision: number) => {
      const payload = toWorkItemPartialUpdate(updates, currentUser);
      return selectedWorkItem.projectSlug
        ? enrichedWorkItemToUI(
            await projectApi.updateWorkItemPartial(
              selectedWorkItem.projectSlug,
              selectedWorkItem.shortId,
              payload,
              expectedRevision
            )
          )
        : enrichedWorkItemToUI(
            standaloneWorkItemDataToEnriched(
              await projectApi.updateStandaloneWorkItemPartial(
                selectedWorkItem.shortId,
                payload,
                selectedWorkItem.orgId
                  ? { orgId: selectedWorkItem.orgId }
                  : undefined,
                expectedRevision
              )
            )
          );
    },
    [
      currentUser,
      selectedWorkItem.orgId,
      selectedWorkItem.projectSlug,
      selectedWorkItem.shortId,
    ]
  );
  const notifyRevisionRetry = useCallback(
    () =>
      emit("orgii-data-changed", {
        project_slug: selectedWorkItem.projectSlug || undefined,
        work_item_id: selectedWorkItem.shortId,
        source: "chat-panel-work-item-conflict-retry",
      }),
    [selectedWorkItem.projectSlug, selectedWorkItem.shortId]
  );
  const {
    revisionConflict,
    handleRevisionConflict,
    useLatestRevisionConflict: handleUseLatest,
    keepMineRevisionConflict: handleKeepMine,
  } = useWorkItemRevisionConflict({
    identityKey: JSON.stringify([
      selectedWorkItem.orgId ?? "personal-org",
      selectedWorkItem.projectSlug ?? null,
      selectedWorkItem.shortId,
    ]),
    readLatest: readLatestSelectedWorkItem,
    retry: retryRevisionUpdate,
    acceptRecord: acceptRevisionRecord,
    recordTitle: (record) => record.name,
    recordDescription: (record) => record.spec,
    recordRevision: (record) => record.revision,
    onRetrySuccess: notifyRevisionRetry,
  });

  return {
    revisionConflict,
    handleRevisionConflict,
    handleUseLatest,
    handleKeepMine,
  };
}
