import { useEffect, useState } from "react";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import { projectSyncApi } from "@src/api/http/project/sync";
import type { ChatPanelSelectedWorkItem } from "@src/store/ui/chatPanel/selectionAtoms";
import { WORK_ITEM_STATUS } from "@src/types/core/workItem";

/**
 * Resolves the owning project's sync adapter (from the navigation payload or
 * a status IPC fallback) and the GitHub/readonly flags derived from it.
 */
export function useWorkItemPanelSyncState(
  selectedWorkItem: ChatPanelSelectedWorkItem
) {
  const [projectSyncAdapter, setProjectSyncAdapter] = useState<{
    projectSlug: string;
    adapterId: string | null;
  } | null>(null);
  const sourceProjectSyncAdapterId =
    selectedWorkItem.sourceProject?.project.syncAdapterId;

  useEffect(() => {
    const projectSlug = selectedWorkItem.projectSlug;
    // Navigation already carries the canonical project record. Only fall back
    // to a status IPC for older/restored tab payloads that lack that field.
    if (!projectSlug || sourceProjectSyncAdapterId !== undefined) return;

    let cancelled = false;
    void projectSyncApi
      .status(projectSlug)
      .then((status) => {
        if (!cancelled) {
          setProjectSyncAdapter({
            projectSlug,
            adapterId: status.adapter_id,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectSyncAdapter({ projectSlug, adapterId: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWorkItem.projectSlug, sourceProjectSyncAdapterId]);

  const projectSyncAdapterId =
    sourceProjectSyncAdapterId ??
    (projectSyncAdapter?.projectSlug === selectedWorkItem.projectSlug
      ? projectSyncAdapter.adapterId
      : undefined);
  const isGitHubSyncedProject =
    projectSyncAdapterId === STORY_SYNC_ADAPTER.GITHUB;
  const selectedWorkItemStatus =
    selectedWorkItem.workItem.workItemStatus ??
    selectedWorkItem.workItem.status;
  const isGitHubWorkItem =
    isGitHubSyncedProject ||
    selectedWorkItemStatus === WORK_ITEM_STATUS.GITHUB_OPEN ||
    selectedWorkItemStatus === WORK_ITEM_STATUS.GITHUB_CLOSED;
  const projectSelectionReadonly =
    Boolean(selectedWorkItem.projectSlug) &&
    (projectSyncAdapterId === undefined || isGitHubSyncedProject);

  return {
    projectSyncAdapterId,
    isGitHubSyncedProject,
    isGitHubWorkItem,
    projectSelectionReadonly,
  };
}
