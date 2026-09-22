/**
 * Selected-row resolution for `useCloudSessionsSection`: which Team row (if
 * any) corresponds to the active replay/import surface, including a replay
 * still parked on its download card.
 */
import { useMemo } from "react";

import { buildCloudRemoteItemId } from "@src/features/Org2Cloud/cloudRemoteItemId";
import type { CloudSessionThread } from "@src/features/Org2Cloud/cloudSessionThreads";
import {
  useCloudSessionDownloadProgressEntry,
  useCloudSessionPendingPlayEntry,
} from "@src/features/Org2Cloud/useCloudSessionDownloadSurface";
import type { Session } from "@src/store/session";

import { resolveCloudDownloadMenuItemId } from "./cloudSessionsSection.selection";

export function useCloudSelectedMenuItemId({
  orgId,
  activeSessionId,
  sessions,
  visibleThreads,
}: {
  orgId: string | null;
  activeSessionId: string;
  sessions: readonly Session[];
  visibleThreads: readonly CloudSessionThread[];
}): string | null {
  const pendingPlay = useCloudSessionPendingPlayEntry(activeSessionId);
  const downloadProgress =
    useCloudSessionDownloadProgressEntry(activeSessionId);

  return useMemo(() => {
    if (!orgId || !activeSessionId) return null;
    const downloadMenuItemId = resolveCloudDownloadMenuItemId(
      orgId,
      pendingPlay ?? downloadProgress
    );
    if (downloadMenuItemId) return downloadMenuItemId;
    const active = sessions.find(
      (session) => session.session_id === activeSessionId
    );
    const imported = active?.importedFrom;
    if (!imported || imported.orgId !== orgId) return null;
    const sourceRow = visibleThreads
      .flatMap((thread) => [thread.root, ...thread.descendants])
      .map((threadRow) => threadRow.row)
      .find(
        (row) =>
          !row.deletedAt && row.sourceSessionId === imported.sourceSessionId
      );
    return sourceRow ? buildCloudRemoteItemId(orgId, sourceRow.id) : null;
  }, [
    activeSessionId,
    downloadProgress,
    orgId,
    pendingPlay,
    sessions,
    visibleThreads,
  ]);
}
