import type { Store } from "jotai/vanilla/store";

import { cloudDeviceIdentity } from "@src/api/tauri/cloudDevice";
import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  conversationTurnIdOf,
  localConversationRootForSession,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type {
  QueuedConversationDispatchCallbacks,
  QueuedConversationExecutionMessage,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  QueuedConversationBlockedError,
  QueuedConversationRecoveryPendingError,
  QueuedConversationTurnClosedError,
  QueuedConversationTurnFailedError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  conversationEventsForPush,
  pushConversationEventsChunked,
} from "@src/features/Org2Cloud/org2CloudConversationEventsClient";
import {
  admitCloudConversationTurn,
  claimCloudConversationTurn,
} from "@src/features/Org2Cloud/org2CloudConversationTurnClient";
import { isRetryableCloudRequestError } from "@src/features/Org2Cloud/org2CloudFetchRetry";

import { createBoundCloudAuth } from "./cloudConversationQueueAdapter.boundAuth";
import { createCloudTurnCoordination } from "./cloudConversationQueueAdapter.coordination";
import {
  createCloudTailPublisher,
  loadCloudConversationTimeline,
} from "./cloudConversationQueueAdapter.plane";
import {
  CLOUD_TURN_LEASE_SECONDS,
  cloudLocator,
  probeCloudTurnCoordination,
} from "./cloudConversationQueueAdapter.support";
import { prepareCloudConversationRetry } from "./cloudConversationRetry";
import {
  bumpConversationPlaneSignal,
  conversationPlaneSignalAtom,
} from "./conversationPlaneAtom";
import {
  buildPushedUserEvent,
  closeConversationTurnWithFailure,
  runConversationTurn,
} from "./conversationTurnRunner";

/** Cloud authority adapter for the application's existing durable queue. */
export async function dispatchQueuedCloudConversation(
  store: Store,
  message: QueuedConversationExecutionMessage,
  root: ConversationRootLocator,
  callbacks: QueuedConversationDispatchCallbacks
): Promise<void> {
  const descriptor = message.conversationDispatch;
  if (!descriptor) throw new Error("canonical conversation target is missing");
  const { orgId, rootSessionId, sourceEndpointUrl } = cloudLocator(root);

  const expectedIdentityKey = descriptor.dispatchIdentityKey;
  if (!expectedIdentityKey) {
    throw new QueuedConversationBlockedError(
      "This restored Cloud turn predates sender binding; edit and send it again under the current account"
    );
  }
  const boundAuth = createBoundCloudAuth({
    store,
    expectedIdentityKey,
    sourceEndpointUrl,
  });
  const { requireBoundAuth, refreshBoundAuth } = boundAuth;

  const auth = await refreshBoundAuth();
  const authIdentityKey = expectedIdentityKey;
  const coordinationEnabled = await probeCloudTurnCoordination(auth);
  // The durable root lock is held by the queue dispatcher. Only an explicit
  // retry changes intent and supersedes a proved, empty native attempt.
  const retry = await prepareCloudConversationRetry(message);

  // Build the canonical user payload once. It is admitted to the shared plane
  // before the local provider turn starts; retries reuse the stable turn id.
  const userEvents = await conversationEventsForPush(
    buildPushedUserEvent(
      message.displayContent,
      message.content,
      message.imageDataUrls,
      new Date().toISOString(),
      message.turnIntentId
    )
  );
  if (
    coordinationEnabled &&
    (userEvents.length !== 1 || userEvents[0]?.source !== "user")
  ) {
    // 0028 atomically admits exactly one Agent-directed user event. The
    // existing large-event codec expands an oversized event into system
    // chunks, which cannot be admitted without splitting publication from
    // FIFO ownership. Fail closed rather than bypass cross-device ordering.
    throw new QueuedConversationBlockedError(
      "This message is too large for coordinated Cloud execution"
    );
  }
  requireBoundAuth();
  let userEventPublished = false;
  const coordination = createCloudTurnCoordination({
    enabled: coordinationEnabled,
    orgId,
    rootSessionId,
    turnId: message.turnIntentId,
    auth: boundAuth,
  });
  const { stopLeaseRenewal } = coordination;
  const publishTail = createCloudTailPublisher({
    store,
    orgId,
    rootSessionId,
    auth: boundAuth,
  });

  const loadTimeline = () =>
    loadCloudConversationTimeline({
      store,
      auth,
      authIdentityKey,
      orgId,
      rootSessionId,
      message,
      requireBoundAuth,
    });
  try {
    const loaded = await loadTimeline();
    const sourceSession = loaded.sourceSession;
    const sessions = loaded.sessions;
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

    // A retry may already have admitted this exact user row. It is never part
    // of the provider prefix: the selected runtime receives it exactly once
    // through the ordinary dispatch path below.
    const preTurnTimeline = loaded.timeline.filter(
      (event) => conversationTurnIdOf(event) !== message.turnIntentId
    );
    // Native/App-origin history is published by the existing full-replay
    // owner before Cloud authority is admitted. This turn adapter owns only
    // the new plane user row and its provider tail; appending old local child
    // history here would create a second writer and place it at today's plane
    // sequence rather than its original transcript position.
    let timeline = preTurnTimeline;

    // Crossing into this RPC can be irreversible when its response is lost:
    // Cloud may already contain the idempotent human row. Ambiguous failures
    // keep the same turn owner; a definitive 4xx remains editable because it
    // proves that this write did not commit.
    const admissionAuth = requireBoundAuth();
    if (coordinationEnabled) {
      const device = await cloudDeviceIdentity();
      coordination.state.deviceId = device.deviceId;
      await admitCloudConversationTurn(
        admissionAuth.accessToken,
        {
          orgId,
          rootSessionId,
          turnId: message.turnIntentId,
          event: userEvents[0]!,
        },
        {
          supabaseUrl: admissionAuth.supabaseUrl,
          anonKey: admissionAuth.supabaseAnonKey,
        }
      );
      userEventPublished = true;
      requireBoundAuth();
      bumpConversationPlaneSignal(
        (update) => store.set(conversationPlaneSignalAtom, update),
        orgId
      );
      const claimAuth = await refreshBoundAuth();
      const claim = await claimCloudConversationTurn(
        claimAuth.accessToken,
        {
          ...coordination.identity(),
          leaseSeconds: CLOUD_TURN_LEASE_SECONDS,
        },
        {
          supabaseUrl: claimAuth.supabaseUrl,
          anonKey: claimAuth.supabaseAnonKey,
        }
      );
      requireBoundAuth();
      if (claim.outcome === "waiting") {
        throw new QueuedConversationRecoveryPendingError(
          `another Cloud turn is ahead; retry after ${claim.retryAfterMs}ms`
        );
      }
      if (claim.outcome === "terminal") {
        coordination.state.alreadyTerminal = true;
        if (claim.status === "completed") return;
        if (
          claim.status === "failed" &&
          retry.lineage.failed?.turnIntentId === message.turnIntentId
        ) {
          throw new QueuedConversationTurnFailedError("Agent request failed");
        }
        throw new QueuedConversationTurnClosedError(
          `Cloud conversation turn is already ${claim.status}`
        );
      }
      coordination.state.claimed = true;
      coordination.state.accepted = claim.outcome === "accepted";
      coordination.startLeaseRenewal();
      // The predecessor may finish between the admission preflight read and
      // our successful claim. Materialize from history read under FIFO
      // ownership, never from that potentially stale preflight snapshot.
      bumpConversationPlaneSignal(
        (update) => store.set(conversationPlaneSignalAtom, update),
        orgId
      );
      timeline = (await loadTimeline()).timeline.filter(
        (event) => conversationTurnIdOf(event) !== message.turnIntentId
      );
      if (message.status === "accepted" || claim.outcome === "accepted") {
        if (!message.runnerSessionId) {
          throw new QueuedConversationRecoveryPendingError(
            "accepted Cloud turn is waiting for its local runner address"
          );
        }
        await coordination.markAccepted();
        // Cloud `accepted` means this device crossed the non-stealable FIFO
        // boundary immediately before provider dispatch. It is not itself
        // proof that the local provider accepted the turn. After a crash in
        // that narrow window, keep the durable delivery `preparing` so native
        // turn-intent recovery may either reconnect or perform the first send.
        // Only a delivery already persisted as accepted may restore that
        // irreversible local boundary here.
        if (message.status === "accepted") {
          try {
            await callbacks.onAccepted(message.runnerSessionId);
          } catch (error) {
            throw new QueuedConversationRecoveryPendingError(
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    } else {
      // Pre-0028 endpoints retain the exact existing idempotent publication
      // path. Capability rollout is additive and never changes old workflow.
      await pushConversationEventsChunked(
        admissionAuth.accessToken,
        {
          orgId,
          rootSessionId,
          turnId: message.turnIntentId,
          events: userEvents,
        },
        {
          supabaseUrl: admissionAuth.supabaseUrl,
          anonKey: admissionAuth.supabaseAnonKey,
        }
      );
      userEventPublished = true;
      requireBoundAuth();
      bumpConversationPlaneSignal(
        (update) => store.set(conversationPlaneSignalAtom, update),
        orgId
      );
    }

    const { syncSessionSharedFiles } =
      await import("../syncSessionSharedFiles");
    await syncSessionSharedFiles({
      token: admissionAuth.accessToken,
      endpoint: {
        supabaseUrl: admissionAuth.supabaseUrl,
        anonKey: admissionAuth.supabaseAnonKey,
        webOrigin: "",
        isOfficial: false,
      },
      orgId,
      sessionId: rootSessionId,
      events: userEvents,
      repoPath: sourceSession?.repoPath,
      assertCurrentIdentity: requireBoundAuth,
    });
    let accepted = false;
    const accept = async (sessionId: string) => {
      if (accepted) return;
      accepted = true;
      await callbacks.onAccepted(sessionId);
    };
    const result = await runConversationTurn({
      root: executionRoot ?? root,
      conversationTitle:
        sourceSession?.name ??
        sessions.find((session) => session.session_id === rootSessionId)
          ?.name ??
        "Conversation",
      displayText: message.displayContent,
      agentContent: message.content,
      imageDataUrls: message.imageDataUrls,
      timeline,
      target: descriptor.target,
      turnIntentId: message.turnIntentId,
      queueMessageId: message.id,
      retry,
      ...(message.runnerSessionId
        ? {
            recovery: {
              runnerSessionId: message.runnerSessionId,
              eventStartIndex: message.runnerEventStartIndex,
              providerAccepted: message.status === "accepted",
            },
          }
        : {}),
      publishTail,
      onRunnerReady: async (runnerSessionId, turnId, eventStartIndex) => {
        void turnId;
        await callbacks.onRunnerReady?.(runnerSessionId, eventStartIndex);
      },
      onBeforeTurnDispatch: coordination.markAccepted,
      onTurnAccepted: accept,
    });
    // Cloud publication is part of the accepted execution's completion. If it
    // failed, the same durable row reconnects to this native turn and retries
    // the idempotent push without running the provider again.
    await accept(result.runnerSessionId);
    await stopLeaseRenewal();
    await coordination.finish(result.terminalStatus);
  } catch (error) {
    if (error instanceof QueuedConversationRecoveryPendingError) {
      throw error;
    }
    if (
      error instanceof QueuedConversationTurnClosedError ||
      error instanceof QueuedConversationTurnFailedError
    ) {
      if (coordination.state.claimed && !coordination.state.alreadyTerminal) {
        await stopLeaseRenewal();
        await coordination.finish("failed");
      }
      throw error;
    }
    if (isRetryableCloudRequestError(error)) {
      // The response may have been lost after the idempotent write committed,
      // or a 5xx may recover. Keep exactly this owner and turn id; recovery
      // never sends a second provider request after acceptance.
      throw new QueuedConversationRecoveryPendingError(
        error instanceof Error ? error.message : String(error)
      );
    }
    if (
      coordinationEnabled &&
      userEventPublished &&
      !coordination.state.claimed
    ) {
      // Admission and FIFO ownership are one logical handoff. A definitive
      // claim rejection must retain the active execution owner; the queue's
      // ordinary blocked path demotes/removes it and would orphan this Cloud
      // FIFO head. Retry the same idempotent claim until it can be reconciled.
      throw new QueuedConversationRecoveryPendingError(
        error instanceof Error ? error.message : String(error)
      );
    }
    if (!userEventPublished) {
      // A definitive rejection before the canonical user row exists is still
      // editable. Return it to the existing visible held queue instead of
      // creating a provider turn or retrying an unchanged 4xx forever.
      throw new QueuedConversationBlockedError(
        error instanceof Error ? error.message : String(error)
      );
    }
    // The user row is durable and the failure is definitive. Close the same
    // visible turn through the shared terminal-event boundary. If that final
    // write is ambiguous it alone remains recovery-pending; a definitive 4xx
    // closes the owner and never reruns the provider.
    try {
      return await closeConversationTurnWithFailure({
        rootLabel: `org2-cloud:${rootSessionId}`,
        error,
        turnIntentId: message.turnIntentId,
        publishTail,
      });
    } catch (closeError) {
      if (
        closeError instanceof QueuedConversationTurnClosedError &&
        coordination.state.claimed
      ) {
        await stopLeaseRenewal();
        await coordination.finish("failed");
      }
      throw closeError;
    }
  } finally {
    await stopLeaseRenewal();
  }
}
