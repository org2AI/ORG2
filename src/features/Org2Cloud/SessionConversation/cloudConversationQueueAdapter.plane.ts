/**
 * Shared-plane I/O for `cloudConversationQueueAdapter`: materializing the
 * canonical timeline the provider runs against, and publishing a turn's
 * provider tail back to the plane.
 */
import type { Store } from "jotai/vanilla/store";

import { loadCanonicalConversationEvents } from "@src/engines/SessionCore/conversations/canonicalConversationEvents";
import { localConversationRootForSession } from "@src/engines/SessionCore/conversations/localConversationContinuation";
import { loadLocalCanonicalConversationTimeline } from "@src/engines/SessionCore/conversations/localConversationExecutionTail";
import {
  QueuedConversationBlockedError,
  type QueuedConversationExecutionMessage,
  QueuedConversationRecoveryPendingError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { buildCloudSessionFetchClient } from "@src/features/Org2Cloud/org2CloudBackendAdapter";
import { listSessionComments } from "@src/features/Org2Cloud/org2CloudCommentsClient";
import {
  Org2CloudConversationError,
  pushConversationEventsChunked,
} from "@src/features/Org2Cloud/org2CloudConversationEventsClient";
import { endpointForOrigin } from "@src/features/Org2Cloud/org2CloudOrgEndpointRouter";
import {
  fetchCloudOrgRemoteSessions,
  org2CloudRemoteSessionsAtom,
  remoteSessionsEntryForIdentity,
} from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import { findImportedSession } from "@src/features/TeamCollaboration/engine/collabImportIdentity";
import { importRemoteSession } from "@src/features/TeamCollaboration/engine/collabSessionImport";
import type { Session } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";

import {
  CanonicalConversationFamilyUnavailableError,
  loadCanonicalConversationTimeline,
} from "./canonicalConversationTimeline";
import type { BoundCloudAuth } from "./cloudConversationQueueAdapter.boundAuth";
import { sessionById } from "./cloudConversationQueueAdapter.support";
import {
  type ConversationFamilyMember,
  resolveConversationFamily,
} from "./continuationEvents";
import {
  bumpConversationPlaneSignal,
  conversationPlaneAtom,
  conversationPlaneKey,
  conversationPlaneSignalAtom,
  loadCompleteConversationPlaneEvents,
  refreshConversationPlaneEntry,
} from "./conversationPlaneAtom";

export interface LoadedCloudConversationTimeline {
  sourceSession: Session | undefined;
  sessions: Session[];
  timeline: SessionEvent[];
}

export async function loadCloudConversationTimeline(input: {
  store: Store;
  auth: Org2CloudAuthState;
  authIdentityKey: string;
  orgId: string;
  rootSessionId: string;
  message: QueuedConversationExecutionMessage;
  requireBoundAuth: BoundCloudAuth["requireBoundAuth"];
}): Promise<LoadedCloudConversationTimeline> {
  const {
    store,
    auth,
    authIdentityKey,
    orgId,
    rootSessionId,
    message,
    requireBoundAuth,
  } = input;
  const key = conversationPlaneKey({
    authIdentityKey,
    orgId,
    rootSessionId,
  });
  const plane = await refreshConversationPlaneEntry({
    store,
    auth,
    orgId,
    rootSessionId,
    getEntry: () => store.get(conversationPlaneAtom)[key],
    setEntries: (update) => store.set(conversationPlaneAtom, update),
    setAuth: (update) => store.set(org2CloudAuthAtom, update),
    invalidationKey: `signal:${
      store.get(conversationPlaneSignalAtom)[orgId] ?? 0
    }`,
  });
  if (plane.state !== "ready") {
    throw new Org2CloudConversationError(
      "ORG2_VALIDATION: canonical conversation plane is unavailable"
    );
  }
  let remoteEntry = remoteSessionsEntryForIdentity(
    store.get(org2CloudRemoteSessionsAtom)[orgId],
    authIdentityKey
  );
  if (!remoteEntry || remoteEntry.state !== "ready") {
    // Execution owns this demand: a cold/hidden/unmounted sidebar cannot
    // be the only actor capable of unblocking an accepted user intent.
    await fetchCloudOrgRemoteSessions(store, orgId, { full: true });
    requireBoundAuth();
    remoteEntry = remoteSessionsEntryForIdentity(
      store.get(org2CloudRemoteSessionsAtom)[orgId],
      authIdentityKey
    );
  }
  if (!remoteEntry || remoteEntry.state !== "ready") {
    throw new QueuedConversationRecoveryPendingError(
      "Cloud conversation family metadata is not ready"
    );
  }
  // The plane loader may refresh and commit a newer access token. Every
  // subsequent read in this attempt must use that same current auth snapshot
  // rather than the token captured before the plane refresh.
  const currentAuth = requireBoundAuth();
  const currentEndpoint = {
    supabaseUrl: currentAuth.supabaseUrl,
    anonKey: currentAuth.supabaseAnonKey,
  };
  const planeEvents = plane.hasEarlierEvents
    ? await loadCompleteConversationPlaneEvents(
        currentAuth.accessToken,
        { orgId, rootSessionId },
        currentEndpoint
      )
    : plane.events;
  requireBoundAuth();

  const sourceSession = sessionById(store, message.sessionId);
  const sessions = store.get(sessionsAtom);
  const family = resolveConversationFamily(remoteEntry.rows, rootSessionId);
  const rootRow = remoteEntry.rows.find(
    (row) => row.sourceSessionId === rootSessionId
  );
  if (!rootRow) {
    // The identity-bound listing is ready, so absence is an admission
    // failure for viewers as well as owners, not an unbounded hydration
    // retry. Keep the failed intent visible and editable. Only owner-local
    // sessions may re-resolve to local authority; viewers must not bypass
    // a revoked/expired share by silently changing authority.
    if (sourceSession && !sourceSession.importedFrom) {
      throw new QueuedConversationBlockedError(
        "This shared session is no longer available in Cloud; retry to continue it locally"
      );
    }
    throw new QueuedConversationBlockedError(
      "This shared session is no longer available in Cloud; refresh or ask its owner to share it again"
    );
  }
  const listing = await listSessionComments(
    currentAuth.accessToken,
    orgId,
    rootSessionId,
    { endpoint: currentEndpoint }
  );
  requireBoundAuth();
  const fetchClient = buildCloudSessionFetchClient(currentAuth.accessToken, {
    ...endpointForOrigin(currentAuth.supabaseUrl),
    anonKey: currentAuth.supabaseAnonKey,
  });
  const loadMemberEvents = async (
    bareSessionId: string,
    member: ConversationFamilyMember | null
  ): Promise<readonly SessionEvent[] | null> => {
    const row = member?.row ?? rootRow;
    const local =
      sessions.find((session) => session.session_id === bareSessionId) ??
      findImportedSession(
        sessions,
        orgId,
        bareSessionId,
        currentAuth.supabaseUrl
      );
    // External native histories are intentionally absent from sessionsAtom
    // but remain readable by their canonical id.
    let localSessionId =
      local?.session_id ??
      (message.sessionId === bareSessionId ? message.sessionId : undefined);
    if (!localSessionId) {
      if (
        row.deletedAt ||
        row.eventsEpoch === undefined ||
        row.eventsCount === undefined ||
        row.eventsCount === 0
      ) {
        return [];
      }
      const imported = await importRemoteSession({
        client: fetchClient,
        orgId,
        remoteSession: row,
        sourceEndpointUrl: currentAuth.supabaseUrl,
      });
      localSessionId = imported?.localSessionId;
    }
    if (!localSessionId) return null;
    // The owner may already have native execution children from before
    // sharing. The plane contains new turns, not every provider-native row
    // in those children; reading only the root would drop that history and
    // make its existing native UUID fail prefix verification on continuation.
    const localRoot = !local?.importedFrom
      ? localConversationRootForSession(
          localSessionId,
          local?.cliAgentType,
          local?.agentDefinitionId
        )
      : null;
    return localRoot
      ? loadLocalCanonicalConversationTimeline(localRoot)
      : (await loadCanonicalConversationEvents(localSessionId)).events;
  };
  try {
    return {
      sourceSession,
      sessions,
      timeline: await loadCanonicalConversationTimeline({
        family,
        anchorBareSessionId: rootSessionId,
        planeEvents,
        planeHistoryStartedAt: plane.historyStartedAt,
        comments: listing.comments,
        streamSessionId: message.sessionId,
        viewer: { status: "known", userId: currentAuth.userId },
        loadMemberEvents,
      }),
    };
  } catch (error) {
    if (error instanceof CanonicalConversationFamilyUnavailableError) {
      throw new QueuedConversationRecoveryPendingError(error.message);
    }
    throw error;
  }
}

/** Publish one turn's provider tail to the plane under the bound account. */
export function createCloudTailPublisher(input: {
  store: Store;
  orgId: string;
  rootSessionId: string;
  auth: BoundCloudAuth;
}): (turnId: string, events: SessionEvent[]) => Promise<void> {
  const { store, orgId, rootSessionId } = input;
  const { requireBoundAuth, refreshBoundAuth } = input.auth;
  return async (turnId: string, events: SessionEvent[]) => {
    const fresh = await refreshBoundAuth();
    const freshEndpoint = {
      supabaseUrl: fresh.supabaseUrl,
      anonKey: fresh.supabaseAnonKey,
    };
    await pushConversationEventsChunked(
      fresh.accessToken,
      {
        orgId,
        rootSessionId,
        turnId,
        events,
      },
      freshEndpoint
    );
    requireBoundAuth();
    const { syncSessionSharedFiles } =
      await import("../syncSessionSharedFiles");
    await syncSessionSharedFiles({
      token: fresh.accessToken,
      endpoint: { ...freshEndpoint, webOrigin: "", isOfficial: false },
      orgId,
      sessionId: rootSessionId,
      events,
      assertCurrentIdentity: requireBoundAuth,
    });
    bumpConversationPlaneSignal(
      (update) => store.set(conversationPlaneSignalAtom, update),
      orgId
    );
  };
}
