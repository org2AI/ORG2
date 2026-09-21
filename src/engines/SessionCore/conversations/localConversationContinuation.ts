/**
 * Provider-neutral local continuation for one canonical conversation.
 *
 * The canonical transcript can come from Cloud, an imported session, or a
 * normal local Session. Execution always happens on this device with the
 * caller's selected local runtime/account/workspace. A normal persisted
 * Session is the continuation record: `parentSessionId` groups its hidden
 * execution episodes under a deterministic conversation parent, so no
 * localStorage runner registry or parallel continuation database is needed.
 */
import { rpc } from "@src/api/tauri/rpc";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  UserIntentSendError,
  activateUserIntentPreparation,
  adoptAcceptedUserIntent,
  confirmUserIntentPreparation,
  failUserIntentPreparation,
  isUserIntentSendError,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { loadAuthoritativeSessionEvents } from "@src/engines/SessionCore/sync/authoritativeSessionEvents";
import { createLogger } from "@src/hooks/logger";

import type {
  ContinueLocalConversationAfterTimelineLoadParams,
  ContinueLocalConversationParams,
  ContinueLocalConversationResult,
  RecoverLocalConversationParams,
} from "./localConversationContinuationTypes";
import {
  type ExecutionCandidate,
  candidateMatchesTarget,
  findCompatibleExecution,
  listExecutionCandidates,
} from "./localConversationExecutionTargets";
import { hydrateSynchronizedConversationProjection } from "./localConversationSettledTail";
import {
  assertSupportedConversationTarget,
  dispatchConversationMessage,
  finishConversationTurn,
  isCodexNativeEpisodeAlreadyOwned,
  notifyConversationTurnAccepted,
  prepareConversationTurn,
  runCreatedConversationTurn,
} from "./localConversationTurnDispatch";
import { conversationTurnIdOf } from "./localConversationTurnIdentity";
import {
  nativeConversationItemsAreProviderPortablePrefix,
  projectNativeConversationItems,
  synchronizeNativeConversation,
} from "./nativeConversationMaterializer";
import {
  QueuedConversationRecoveryBlockedError,
  QueuedConversationRecoveryPendingError,
} from "./queuedConversationContract";

export type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "./conversationTypes";
export type { ContinueLocalConversationResult } from "./localConversationContinuationTypes";
export {
  conversationExecutionParentId,
  localConversationRootForSession,
  parseConversationExecutionParentId,
} from "./localConversationExecutionIdentity";
export {
  type LocalConversationExecutionTargetSnapshot,
  loadLocalConversationExecutionTargets,
} from "./localConversationExecutionTargets";
export { providerClosedTurnWithoutRecordingPrompt } from "./localConversationSettledTail";
export {
  CONVERSATION_TURN_ID_ARG,
  conversationTurnIdOf,
} from "./localConversationTurnIdentity";

const log = createLogger("localConversationContinuation");

async function continueLocalConversationAtQueueHead(
  params: ContinueLocalConversationParams,
  knownCandidates?: readonly ExecutionCandidate[],
  reloadTimelineForRollover?: () => Promise<readonly SessionEvent[]>
): Promise<ContinueLocalConversationResult> {
  // Queue admission renders the new user row immediately on the canonical
  // source. Materialization must rebuild the transcript *before* that turn;
  // the provider receives it exactly once through dispatchUserIntent below.
  const effectiveParams = {
    ...params,
    timeline: params.timeline.filter(
      (event) => conversationTurnIdOf(event) !== params.turnIntentId
    ),
  };
  // Publishing the canonical user turn is independent of local execution
  // discovery. Cloud/root surfaces can render it while a native episode is
  // still being verified or materialized.
  const compatible = await findCompatibleExecution(
    effectiveParams.root,
    effectiveParams.target,
    effectiveParams.timeline,
    knownCandidates
  );
  if (compatible) {
    const preparation = await prepareConversationTurn(
      compatible.sessionId,
      effectiveParams,
      "dispatch"
    );
    // Synchronizing a large canonical delta is part of the accepted user
    // intent, not a pre-submit loading screen. Use the same optimistic row,
    // generation, and planning footer as an ordinary queued send before any
    // provider-native I/O begins.
    confirmUserIntentPreparation(preparation);
    let dispatched: Awaited<ReturnType<typeof dispatchConversationMessage>>;
    try {
      await effectiveParams.onSessionPreparing?.(compatible.sessionId);
      activateUserIntentPreparation(preparation);
      const beforeSynchronization = compatible.events;
      const synchronized = await synchronizeNativeConversation({
        sessionId: compatible.sessionId,
        timeline: effectiveParams.timeline,
      });
      compatible.events = synchronized.events;
      if (effectiveParams.target.cliAgentType) {
        await hydrateSynchronizedConversationProjection(
          compatible.sessionId,
          beforeSynchronization,
          synchronized.events
        );
      }
      // Reveal/follow the writable episode before dispatch. The ordinary
      // optimistic row and planning footer are already mounted while native
      // synchronization runs; this exact boundary only opens the live event
      // overlay at the verified pre-turn prefix.
      await effectiveParams.onSessionReady?.(
        compatible.sessionId,
        compatible.events.length
      );
      await effectiveParams.onBeforeTurnDispatch?.(compatible.sessionId);
      dispatched = await dispatchConversationMessage(
        compatible.sessionId,
        effectiveParams,
        {
          // Permission is not a trigger: the native transport still requires
          // an explicit context-exhausted terminal with zero assistant/tool
          // output. A compatible episode is already synchronized to the
          // canonical prefix, so provider-native compact/rollover is the
          // cheapest first recovery. The fresh canonical rebuild below
          // remains the fallback when native recovery itself fails.
          allowNativeContextRecovery: true,
          runtimeStatusSource: "dispatch",
          preparation,
        }
      );
    } catch (error) {
      if (error instanceof QueuedConversationRecoveryPendingError) throw error;
      const rebuildReason = isCodexNativeEpisodeAlreadyOwned(
        error,
        effectiveParams.target
      )
        ? "its native UUID has an active writer"
        : null;
      if (rebuildReason) {
        const rolloverTimeline = reloadTimelineForRollover
          ? await reloadTimelineForRollover()
          : effectiveParams.timeline;
        // The native App exclusively owns this UUID, but synchronization has
        // already verified its history against the canonical timeline.
        // Discard only this failed optimistic echo and rebuild a fresh episode.
        // A prefix mismatch is NOT a rollover signal: rebuilding from a shorter
        // or divergent plane could silently omit native-only tool/output rows.
        // That error follows the ordinary visible failed-intent path below.
        // runCreatedConversationTurn does not recurse through candidate lookup,
        // which bounds this recovery to one automatic resend of the same intent.
        await eventStoreProxy.removeSyntheticUserInputEvents(
          compatible.sessionId,
          {
            matchingContents: [],
            matchingTurnIntentIds: [effectiveParams.turnIntentId],
          }
        );
        log.info(
          `[localConversationContinuation] rebuilding episode ${compatible.sessionId} because ${rebuildReason}`
        );
        return runCreatedConversationTurn(effectiveParams, {
          loadTimeline: async () => rolloverTimeline,
          onSessionCreated: effectiveParams.onSessionPreparing,
        });
      }
      log.error(
        `[localConversationContinuation] resume turn failed for ${compatible.sessionId}:`,
        error
      );
      await failUserIntentPreparation(preparation, error).catch(
        () => undefined
      );
      throw isUserIntentSendError(error)
        ? error
        : new UserIntentSendError(error, preparation.userEvent.id);
    }
    await notifyConversationTurnAccepted(
      effectiveParams.onTurnAccepted,
      compatible.sessionId,
      effectiveParams.turnIntentId
    );
    const finished = await finishConversationTurn({
      sessionId: compatible.sessionId,
      before: compatible.events,
      turnIntentId: effectiveParams.turnIntentId,
      providerRequest: {
        text: effectiveParams.agentContent ?? effectiveParams.displayText,
        images: effectiveParams.imageDataUrls ?? [],
      },
      generation: dispatched.preparation.generation,
    });
    return {
      sessionId: compatible.sessionId,
      terminalStatus: finished.terminalStatus,
      agentTail: finished.agentTail,
    };
  }

  return runCreatedConversationTurn(effectiveParams, {
    loadTimeline: async () => effectiveParams.timeline,
    onSessionCreated: effectiveParams.onSessionPreparing,
  });
}

/**
 * Reconnect a durable queue row to a provider turn accepted before this
 * renderer stopped. `session_turn_intents` is the acceptance authority; the
 * queue contributes only the concrete runner address needed to find it.
 * Returning `null` proves the backend never accepted this intent, so the
 * caller may safely run the ordinary dispatch path with the same id.
 */
export async function recoverLocalConversationTurn(
  params: RecoverLocalConversationParams
): Promise<ContinueLocalConversationResult | null> {
  assertSupportedConversationTarget(params.target);
  const durableIntent = await rpc.sessionCore.turnIntents.status({
    sessionId: params.runnerSessionId,
    turnIntentId: params.turnIntentId,
  });
  if (!durableIntent || durableIntent.status === "optimistic") return null;
  if (["stale", "coalesced", "rejected"].includes(durableIntent.status)) {
    throw new QueuedConversationRecoveryBlockedError(
      `conversation turn was retired before provider execution (${durableIntent.status}); edit or retry it as a new intent`
    );
  }

  // The backend turn-intent row is the provider-acceptance authority. A
  // renderer can stop after that row becomes queued/running/terminal but
  // before the frontend delivery receipt advances from `preparing`. Restore
  // that irreversible boundary before doing any transcript/candidate reads:
  // those reads may remain temporarily unavailable, but the queue must never
  // present the accepted user turn as Sending or make it eligible for a fresh
  // provider launch.
  await params.onBeforeTurnDispatch?.(params.runnerSessionId);
  await notifyConversationTurnAccepted(
    params.onTurnAccepted,
    params.runnerSessionId,
    params.turnIntentId
  );

  const candidates = await listExecutionCandidates(params.root);
  const belongsToRoot =
    candidates.some(
      (candidate) => candidate.sessionId === params.runnerSessionId
    ) ||
    (params.root.authority === "local-session" &&
      params.root.conversationId === params.runnerSessionId);
  if (
    !belongsToRoot ||
    !(await candidateMatchesTarget(params.runnerSessionId, params.target))
  ) {
    throw new QueuedConversationRecoveryBlockedError(
      "durable conversation runner no longer belongs to this root/target"
    );
  }

  const timeline = params.timeline.filter(
    (event) => conversationTurnIdOf(event) !== params.turnIntentId
  );
  const { events } = await loadAuthoritativeSessionEvents(
    params.runnerSessionId
  );
  const canonicalItems = projectNativeConversationItems(timeline);
  const executionItems = projectNativeConversationItems(events);
  if (
    !nativeConversationItemsAreProviderPortablePrefix(
      canonicalItems,
      executionItems
    )
  ) {
    throw new QueuedConversationRecoveryBlockedError(
      "accepted conversation runner diverged from the canonical transcript"
    );
  }

  const adopted = adoptAcceptedUserIntent({
    sessionId: params.runnerSessionId,
    turnIntentId: params.turnIntentId,
    runtimeStatusSource: "dispatch",
  });
  try {
    await params.onSessionPreparing?.(params.runnerSessionId);
    await params.onSessionReady?.(
      params.runnerSessionId,
      params.eventStartIndex ?? timeline.length
    );
    const finished = await finishConversationTurn({
      sessionId: params.runnerSessionId,
      before: timeline,
      turnIntentId: params.turnIntentId,
      providerRequest: {
        text: params.agentContent ?? params.displayText,
        images: params.imageDataUrls ?? [],
      },
      generation: adopted.generation,
      settleAdoptedLifecycle: true,
    });
    return {
      sessionId: params.runnerSessionId,
      terminalStatus: finished.terminalStatus,
      agentTail: finished.agentTail,
    };
  } catch (error) {
    if (error instanceof QueuedConversationRecoveryPendingError) throw error;
    throw new QueuedConversationRecoveryPendingError(
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function continueLocalConversation(
  params: ContinueLocalConversationParams
): Promise<ContinueLocalConversationResult> {
  assertSupportedConversationTarget(params.target);
  return continueLocalConversationAtQueueHead(params);
}

/**
 * Continue a canonical conversation whose authoritative history is mutable.
 * History is loaded only after the application's singleton durable queue has
 * granted this root its turn. Serialization belongs to
 * useQueueDispatch/turnLifecycle, not to this provider adapter.
 */
export async function continueLocalConversationAfterTimelineLoad(
  params: ContinueLocalConversationAfterTimelineLoadParams
): Promise<ContinueLocalConversationResult> {
  assertSupportedConversationTarget(params.target);
  const { loadTimeline, ...continuationParams } = params;
  const candidates = await listExecutionCandidates(params.root);
  const matchingCandidates: ExecutionCandidate[] = [];
  for (const candidate of candidates) {
    if (await candidateMatchesTarget(candidate.sessionId, params.target)) {
      matchingCandidates.push(candidate);
    }
  }
  if (matchingCandidates.length === 0) {
    // Snapshot while the singleton queue owns this root, before publishing a
    // new native child. An unmaterialized child has no transcript revision;
    // including it in its own source snapshot would make that snapshot
    // permanently unstable and strand the turn before provider dispatch.
    const timeline = await loadTimeline();
    return runCreatedConversationTurn(continuationParams, {
      loadTimeline: async () => timeline,
      onSessionCreated: params.onSessionPreparing,
    });
  }
  const timeline = await loadTimeline();
  return continueLocalConversationAtQueueHead(
    { ...continuationParams, timeline },
    matchingCandidates,
    loadTimeline
  );
}
