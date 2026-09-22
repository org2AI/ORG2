import type { Store } from "jotai/vanilla/store";
import { type Dispatch, type SetStateAction, useEffect } from "react";

import type { Org2CloudAuthState } from "@src/features/Org2Cloud/org2CloudAuthState";
import { loadCloudOrgMembers } from "@src/features/Org2Cloud/org2CloudMembersCoordinator";
import { createLogger } from "@src/hooks/logger";

import { teamInboxCacheAtom } from "./store";
import {
  type CloudMemberSnapshot,
  type RetainedMemberSnapshot,
  readAllProjectMembers,
  retainCloudMemberSnapshot,
  retainMemberSnapshot,
} from "./teamInboxMemberSnapshot";

const log = createLogger("TeamInboxDataSource");

/**
 * Keeps the local project roster and the active cloud org roster current for
 * the mounted Team Inbox scope.
 */
export function useTeamInboxMemberRosters({
  store,
  auth,
  activeCloudOrgId,
  activeCloudRosterVersion,
  authIdentityKey,
  cloudRosterKey,
  localRosterVersion,
  memberSnapshot,
  setMemberSnapshot,
  cloudMemberSnapshot,
  setCloudMemberSnapshot,
}: {
  store: Store;
  auth: Org2CloudAuthState | null;
  activeCloudOrgId: string | null;
  activeCloudRosterVersion: number;
  authIdentityKey: string | null;
  cloudRosterKey: string;
  localRosterVersion: number;
  memberSnapshot: RetainedMemberSnapshot;
  setMemberSnapshot: Dispatch<SetStateAction<RetainedMemberSnapshot>>;
  cloudMemberSnapshot: CloudMemberSnapshot;
  setCloudMemberSnapshot: Dispatch<SetStateAction<CloudMemberSnapshot>>;
}): void {
  useEffect(() => {
    if (memberSnapshot.loadedForRosterVersion === localRosterVersion) return;
    let cancelled = false;
    void readAllProjectMembers()
      .then((nextSnapshot) => {
        if (!cancelled) {
          setMemberSnapshot((current) => {
            return retainMemberSnapshot(
              current,
              nextSnapshot,
              localRosterVersion
            );
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        log.warn("Failed to resolve Team Inbox member identity", error);
        store.set(teamInboxCacheAtom, (current) => ({
          ...current,
          loading: false,
          issue: {
            code: "load_failed",
            detail: error instanceof Error ? error.message : String(error),
          },
          revision: current.revision + 1,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    localRosterVersion,
    memberSnapshot.loadedForRosterVersion,
    setMemberSnapshot,
    store,
  ]);

  useEffect(() => {
    if (!auth || !activeCloudOrgId) {
      return;
    }
    if (
      cloudMemberSnapshot.key === cloudRosterKey &&
      cloudMemberSnapshot.rosterVersion === activeCloudRosterVersion
    ) {
      return;
    }
    let cancelled = false;
    loadCloudOrgMembers(store, auth, activeCloudOrgId, activeCloudRosterVersion)
      .then((loaded) => {
        if (!cancelled) {
          setCloudMemberSnapshot((current) => {
            return retainCloudMemberSnapshot(current, {
              key: cloudRosterKey,
              rosterVersion: activeCloudRosterVersion,
              members: loaded?.members ?? [],
            });
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        log.warn("Failed to resolve Team Inbox cloud org roster", error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeCloudOrgId,
    activeCloudRosterVersion,
    auth,
    authIdentityKey,
    cloudMemberSnapshot.key,
    cloudMemberSnapshot.rosterVersion,
    cloudRosterKey,
    setCloudMemberSnapshot,
    store,
  ]);
}
