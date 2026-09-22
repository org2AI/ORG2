/**
 * Viewer-side reads for `SessionCommentsContext`: the mentionable roster and
 * the admin/anchor capability probes. Shared by the provider and the header
 * extras (which runs its own instance because it mounts outside ChatView).
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";

import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "../org2CloudAuthAtom";
import { getCloudCapabilities } from "../org2CloudCapabilities";
import type { CloudOrgMember } from "../org2CloudClient";
import { loadCloudOrgMembers } from "../org2CloudMembersCoordinator";
import {
  org2CloudOrgsAtom,
  org2CloudRosterVersionAtom,
} from "../org2CloudOrgsAtom";
import {
  org2CloudRemoteSessionsAtom,
  remoteSessionsEntryForIdentity,
} from "../org2CloudRemoteSessionsAtom";
import type { SessionCommentTarget } from "../sessionCommentTarget";

const CLOUD_ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Roster reads share the app-wide coordinator and are keyed by account,
 * endpoint, org, and roster revision. Late identity responses are discarded.
 */
export function useSessionCommentMentionableMembers(
  target: SessionCommentTarget | null
): readonly CloudOrgMember[] {
  const store = useStore();
  const auth = useAtomValue(org2CloudAuthAtom);
  const setAuth = useSetAtom(org2CloudAuthAtom);
  const rosterVersions = useAtomValue(org2CloudRosterVersionAtom);
  const identityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const orgId = target?.orgId ?? null;
  const rosterVersion = orgId ? (rosterVersions[orgId] ?? 0) : 0;
  const requestKey =
    identityKey && orgId ? `${identityKey}|${orgId}|${rosterVersion}` : null;
  const [resolved, setResolved] = useState<{
    key: string;
    members: CloudOrgMember[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!auth || !identityKey || !orgId || !requestKey) return;
    const requestAuth = auth;
    void Promise.all([
      loadCloudOrgMembers(store, requestAuth, orgId, rosterVersion),
      getCloudCapabilities(requestAuth.accessToken),
    ])
      .then(([loaded, capabilities]) => {
        if (!loaded || cancelled) return;
        commitRefreshedAuth(setAuth, requestAuth, loaded.auth);
        const latestAuth = store.get(org2CloudAuthAtom);
        if (
          !latestAuth ||
          org2CloudAuthIdentityKey(latestAuth) !== identityKey ||
          (store.get(org2CloudRosterVersionAtom)[orgId] ?? 0) > rosterVersion
        ) {
          return;
        }
        setResolved({
          key: requestKey,
          members: capabilities.teamInboxMentions
            ? loaded.members.filter((member) => member.status === "active")
            : [],
        });
      })
      .catch(() => {
        if (!cancelled) setResolved({ key: requestKey, members: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [auth, identityKey, orgId, requestKey, rosterVersion, setAuth, store]);

  return resolved?.key === requestKey ? resolved.members : [];
}

/**
 * Viewer-side capability probes shared by the provider and the header
 * extras (which runs its own instance because it mounts outside ChatView).
 */
export function useSessionCommentViewer(target: SessionCommentTarget | null): {
  viewerUserId: string | null;
  viewerIsAdmin: boolean;
  canAnchorTurns: boolean;
} {
  const auth = useAtomValue(org2CloudAuthAtom);
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);
  const remoteEntries = useAtomValue(org2CloudRemoteSessionsAtom);

  return useMemo(() => {
    const role = target
      ? cloudOrgs.find((org) => org.orgId === target.orgId)?.role
      : undefined;
    // Identity-filtered like every other remote-sessions read: a stale row
    // from a previous account must not decide anchor capability (fail-open
    // covers the filtered-out case).
    const row = target
      ? remoteSessionsEntryForIdentity(
          remoteEntries[target.orgId],
          auth ? org2CloudAuthIdentityKey(auth) : null
        )?.rows.find(
          (candidate) => candidate.sourceSessionId === target.sessionId
        )
      : undefined;
    return {
      viewerUserId: auth?.userId ?? null,
      viewerIsAdmin: Boolean(role && CLOUD_ADMIN_ROLES.has(role)),
      // Row unknown (listing not fetched yet) fails OPEN — the server is
      // the real gate (ORG2_REPLAY_NOT_AVAILABLE) and a stale disable
      // would block legitimate anchors.
      canAnchorTurns: row?.accessMode
        ? row.accessMode === COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
        : true,
    };
  }, [target, auth, cloudOrgs, remoteEntries]);
}
