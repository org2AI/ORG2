/**
 * Viewer-local hide markers for `useCloudSessionsSection`: the persisted set
 * of hidden Team Sessions rows, the resubscribe that clears a marker when a
 * replay starts, and the hide action that also removes any imported caches.
 */
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";

import { deleteSession as deleteLocalSession } from "@src/api/tauri/agent";
import { deleteOrgtrackCollaborationSession } from "@src/api/tauri/lineage";
import {
  hiddenRemoteSessionKey,
  readHiddenRemoteSessionIds,
  writeHiddenRemoteSessionIds,
} from "@src/features/Org2Cloud/cloudHiddenRemoteSessions";
import { createLogger } from "@src/hooks/logger";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { removeSession } from "@src/store/session";
import type { Session } from "@src/store/session";

const log = createLogger("CloudSessionsSection");

export interface CloudHiddenRemoteSessions {
  hiddenRemoteSessionIds: Set<string>;
  setHiddenRemoteSessionIds: Dispatch<SetStateAction<Set<string>>>;
  resubscribeRemoteRow: (row: RemoteTeammateSessionMetadata) => void;
  hideRemoteSession: (row: RemoteTeammateSessionMetadata) => void;
}

export function useCloudHiddenRemoteSessions({
  sessions,
}: {
  sessions: readonly Session[];
}): CloudHiddenRemoteSessions {
  const [hiddenRemoteSessionIds, setHiddenRemoteSessionIds] = useState(
    readHiddenRemoteSessionIds
  );

  // Starting a manual replay for a hidden row clears its local hide marker so
  // the imported replay and teammate row become visible again.
  const resubscribeRemoteRow = useCallback(
    (row: RemoteTeammateSessionMetadata) => {
      setHiddenRemoteSessionIds((current) => {
        const key = hiddenRemoteSessionKey(row.orgId, row.id);
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        writeHiddenRemoteSessionIds(next);
        return next;
      });
    },
    []
  );

  const hideRemoteSession = useCallback(
    (row: RemoteTeammateSessionMetadata) => {
      const importedCopies = sessions.filter(
        (session) =>
          session.importedFrom?.orgId === row.orgId &&
          session.importedFrom.sourceSessionId === row.sourceSessionId
      );
      Promise.all(
        importedCopies.map(async (session) => {
          try {
            await deleteOrgtrackCollaborationSession(session.session_id);
          } catch {
            // Derived blame rows are best-effort cleanup; the session cache
            // deletion below remains the user's primary hide action.
          }
          try {
            await deleteLocalSession(session.session_id);
            removeSession(session.session_id);
          } catch {
            // Hiding the remote row remains useful even when a stale local
            // cache was already removed by another path.
          }
        })
      ).catch((error) => {
        log.warn("hiding a Team Sessions row failed:", error);
      });
      setHiddenRemoteSessionIds((current) => {
        const next = new Set(current);
        next.add(hiddenRemoteSessionKey(row.orgId, row.id));
        writeHiddenRemoteSessionIds(next);
        return next;
      });
    },
    [sessions]
  );

  return {
    hiddenRemoteSessionIds,
    setHiddenRemoteSessionIds,
    resubscribeRemoteRow,
    hideRemoteSession,
  };
}
