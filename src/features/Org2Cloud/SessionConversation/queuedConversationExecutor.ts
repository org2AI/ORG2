import type { Store } from "jotai/vanilla/store";

import { loadCanonicalConversationEvents } from "@src/engines/SessionCore/conversations/canonicalConversationEvents";
import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  CONVERSATION_TURN_ID_ARG,
  localConversationRootForSession,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type {
  QueuedConversationDispatchCallbacks,
  QueuedConversationExecutionResult,
  QueuedConversationMessage,
} from "@src/engines/SessionCore/conversations/queuedConversationExecutor";
import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getCloudCapabilitiesConfirmed } from "@src/features/Org2Cloud/org2CloudCapabilities";
import { ensureFreshSession } from "@src/features/Org2Cloud/org2CloudClient";
import { listSessionComments } from "@src/features/Org2Cloud/org2CloudCommentsClient";
import {
  conversationEventsForPush,
  pushConversationEventsChunked,
} from "@src/features/Org2Cloud/org2CloudConversationEventsClient";
import { groupCommentThreads } from "@src/features/Org2Cloud/org2CloudSessionCommentsAtom";
import type { Session } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";

import {
  activeConversationRunnerKey,
  activeConversationRunnersAtom,
  removeConversationRunnerByTurn,
  upsertConversationRunner,
} from "./activeConversationRunnersAtom";
import {
  bumpConversationPlaneSignal,
  conversationPlaneAtom,
  conversationPlaneKey,
  conversationPlaneSignalAtom,
  refreshConversationPlaneEntry,
} from "./conversationPlaneAtom";
import { mergePlaneIntoTranscript } from "./conversationTimeline";
import {
  buildPushedUserEvent,
  runConversationTurn,
} from "./conversationTurnRunner";
import {
  buildDiscussionEvents,
  mergeConversationEvents,
} from "./discussionEvents";

function sessionById(store: Store, sessionId: string): Session | undefined {
  return store
    .get(sessionsAtom)
    .find((candidate) => candidate.session_id === sessionId);
}

function cloudLocator(root: ConversationRootLocator): {
  orgId: string;
  rootSessionId: string;
} {
  const [orgId, ...extraScope] = root.authorityScope;
  if (root.authority !== "org2-cloud" || !orgId || extraScope.length > 0) {
    throw new Error("invalid Cloud conversation identity");
  }
  return { orgId, rootSessionId: root.conversationId };
}

/** Cloud authority adapter for the application's existing durable queue. */
export async function dispatchQueuedCloudConversation(
  store: Store,
  message: QueuedConversationMessage,
  root: ConversationRootLocator,
  callbacks: QueuedConversationDispatchCallbacks
): Promise<QueuedConversationExecutionResult> {
  const descriptor = message.conversationDispatch;
  if (!descriptor) throw new Error("canonical conversation target is missing");
  const { orgId, rootSessionId } = cloudLocator(root);

  const getAccessToken = async (): Promise<string> => {
    const current = store.get(org2CloudAuthAtom);
    if (!current) throw new Error("cloud sign-in required");
    const fresh = await ensureFreshSession(current);
    if (!fresh) throw new Error("cloud auth refresh failed");
    commitRefreshedAuth(
      (update) => store.set(org2CloudAuthAtom, update),
      current,
      fresh
    );
    return fresh.accessToken;
  };

  const auth = store.get(org2CloudAuthAtom);
  if (!auth) throw new Error("cloud sign-in required");
  const authIdentityKey = org2CloudAuthIdentityKey(auth);
  if (descriptor.dispatchIdentityKey !== authIdentityKey) {
    throw new Error(
      descriptor.dispatchIdentityKey
        ? "This queued turn belongs to a different Cloud account; switch back to its author account to send it"
        : "This restored Cloud turn predates sender binding; edit and send it again under the current account"
    );
  }
  const capabilityProbe = await getCloudCapabilitiesConfirmed(
    await getAccessToken()
  );
  if (
    !capabilityProbe.confirmed ||
    !capabilityProbe.capabilities.conversationEventsIdempotency
  ) {
    throw new Error(
      "Cloud conversation idempotency is unavailable; refusing an unsafe retry"
    );
  }
  const runnerRegistryKey = activeConversationRunnerKey(authIdentityKey, root);
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
  });
  if (plane.state !== "ready") {
    throw new Error("canonical conversation plane is unavailable");
  }

  const sourceSession = sessionById(store, message.sessionId);
  const rootLocal = sessionById(store, rootSessionId) ?? sourceSession ?? null;
  const rootEvents = rootLocal
    ? (await loadCanonicalConversationEvents(rootLocal.session_id)).events
    : [];
  const planeTimeline = mergePlaneIntoTranscript(
    rootEvents,
    plane.events,
    message.sessionId,
    { status: "known", userId: auth.userId }
  );
  const listing = await listSessionComments(
    await getAccessToken(),
    orgId,
    rootSessionId
  );
  const sourceIds = new Set(planeTimeline.map((event) => event.id));
  const grouped = groupCommentThreads(listing.comments, sourceIds);
  const bySourceId = new Map(
    planeTimeline.map((event) => [event.id, event] as const)
  );
  const timeline = mergeConversationEvents(
    planeTimeline,
    buildDiscussionEvents(grouped, message.sessionId, bySourceId)
  );
  // A crash after the user-event push but before native-runner persistence leaves
  // this same durable queue row retryable. Its user event is now in the plane,
  // but it must not be materialized into the prefix AND sent again. Exclude the
  // current turn from the canonical prefix on every attempt; the native send
  // remains the one user-message append for this provider episode.
  const executionTimeline = timeline.filter(
    (event) => event.args?.[CONVERSATION_TURN_ID_ARG] !== message.turnIntentId
  );
  const executionRoot =
    sourceSession &&
    !sourceSession.importedFrom &&
    sourceSession.session_id === rootSessionId
      ? (localConversationRootForSession(
          sourceSession.session_id,
          sourceSession.cliAgentType,
          sourceSession.agentDefinitionId
        ) ?? undefined)
      : undefined;

  await pushConversationEventsChunked(await getAccessToken(), {
    orgId,
    rootSessionId,
    turnId: message.turnIntentId,
    events: await conversationEventsForPush(
      buildPushedUserEvent(
        message.displayContent,
        message.content,
        message.imageDataUrls,
        new Date().toISOString(),
        message.turnIntentId
      )
    ),
  });
  bumpConversationPlaneSignal(
    (update) => store.set(conversationPlaneSignalAtom, update),
    orgId
  );

  let accepted = false;
  const accept = async (sessionId: string) => {
    if (accepted) return;
    accepted = true;
    await callbacks.onAccepted(sessionId);
  };
  let result: Awaited<ReturnType<typeof runConversationTurn>> | null = null;
  try {
    result = await runConversationTurn({
      getAccessToken,
      authIdentityKey,
      orgId,
      rootSessionId,
      conversationTitle:
        sourceSession?.name ?? rootLocal?.name ?? "Conversation",
      displayText: message.displayContent,
      agentContent: message.content,
      imageDataUrls: message.imageDataUrls,
      timeline: executionTimeline,
      target: descriptor.target,
      turnIntentId: message.turnIntentId,
      ...(message.status !== "queued" && message.runnerSessionId
        ? {
            recovery: {
              runnerSessionId: message.runnerSessionId,
              eventStartIndex: message.runnerEventStartIndex,
            },
          }
        : {}),
      ...(executionRoot ? { executionRoot } : {}),
      onRunnerReady: async (runnerSessionId, turnId, eventStartIndex) => {
        store.set(activeConversationRunnersAtom, (current) =>
          upsertConversationRunner(current, runnerRegistryKey, {
            runnerSessionId,
            turnId,
            eventStartIndex,
          })
        );
        await callbacks.onRunnerReady?.(runnerSessionId, eventStartIndex);
      },
      onTurnAccepted: accept,
      onPushed: () =>
        bumpConversationPlaneSignal(
          (update) => store.set(conversationPlaneSignalAtom, update),
          orgId
        ),
    });
    if (result.tailPublicationPending) {
      throw new Error(
        "Provider tail is durably queued for Cloud publication; keeping the accepted turn for recovery"
      );
    }
    await accept(result.runnerSessionId);
    return { terminalStatus: result.terminalStatus };
  } finally {
    // A successful non-empty tail remains overlaid until the refreshed plane
    // contains it. Empty cancel/failure tails (and thrown publication errors)
    // have no plane row that could ever trigger that normal cleanup.
    if (
      !result ||
      (result.pushedAgentEventCount === 0 && !result.tailPublicationPending)
    ) {
      store.set(activeConversationRunnersAtom, (current) =>
        removeConversationRunnerByTurn(
          current,
          runnerRegistryKey,
          message.turnIntentId
        )
      );
    }
  }
}
