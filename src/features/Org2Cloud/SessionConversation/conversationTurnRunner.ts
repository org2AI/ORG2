/**
 * Cloud-plane adapter for the provider-neutral local continuation core.
 *
 * Cloud stores and orders canonical events; it never executes an Agent and
 * never receives a local credential. The current local app selects one of its
 * own runtimes, continues a normal persisted child Session, and publishes only
 * that turn's normalized tail back to the shared plane.
 */
import type { TurnTerminalStatus } from "@src/engines/SessionCore/control/turnLifecycle";
import {
  CONVERSATION_TURN_ID_ARG,
  type ConversationRootLocator,
  type LocalConversationTarget,
  continueLocalConversation,
  recoverLocalConversationTurn,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { mintTurnIntentId } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import { createLogger } from "@src/hooks/logger";

import { conversationEventsForPush } from "../org2CloudConversationEventsClient";
import {
  drainConversationTailOutbox,
  stageConversationTail,
} from "./conversationTailOutbox";

const log = createLogger("ConversationTurnRunner");

export function buildPushedUserEvent(
  displayText: string,
  agentContent: string | undefined,
  imageDataUrls: readonly string[] | undefined,
  createdAt: string,
  turnIntentId: string
): SessionEvent {
  const id = `convturn-user-${turnIntentId}`;
  return {
    id,
    chunk_id: id,
    sessionId: "conversation",
    createdAt,
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: { [CONVERSATION_TURN_ID_ARG]: turnIntentId },
    result: {
      type: "user",
      message: { content: agentContent ?? displayText, role: "user" },
      ...(imageDataUrls && imageDataUrls.length > 0
        ? { images: [...imageDataUrls] }
        : {}),
      turnIntentId,
    },
    source: "user",
    displayText,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

function buildPushedDispatchFailureEvent(
  error: unknown,
  createdAt: string,
  turnIntentId: string
): SessionEvent {
  const id = `convturn-error-${turnIntentId}`;
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Agent request failed";
  return {
    id,
    chunk_id: id,
    sessionId: "conversation",
    createdAt,
    functionName: "error",
    uiCanonical: "error",
    actionType: "error",
    args: { [CONVERSATION_TURN_ID_ARG]: turnIntentId },
    result: { error: message, success: false, turnIntentId },
    // A system error renders through the existing AgentErrorChatItem but is
    // deliberately absent from provider-native role/tool materialization.
    source: "system",
    displayText: message,
    displayStatus: "failed",
    displayVariant: "error",
    activityStatus: "processed",
    payloadRefs: [],
  } as SessionEvent;
}

interface RunConversationTurnParams {
  /** Resolved separately for every push; long turns may outlive a JWT. */
  getAccessToken: () => Promise<string>;
  authIdentityKey: string;
  orgId: string;
  rootSessionId: string;
  conversationTitle: string;
  displayText: string;
  agentContent?: string;
  imageDataUrls?: string[];
  /** Canonical merged transcript immediately before this turn. */
  timeline: readonly SessionEvent[];
  /** Composer-selected local runtime/account/model. Never resolved by a modal. */
  target: LocalConversationTarget;
  /**
   * A compatible local native root can be reused directly. Otherwise this
   * device keeps its own durable execution episode for the Cloud root.
   */
  executionRoot?: ConversationRootLocator;
  turnIntentId?: string;
  recovery?: { runnerSessionId: string; eventStartIndex?: number };
  onRunnerReady?: (
    sessionId: string,
    turnId: string,
    eventStartIndex: number
  ) => void | Promise<void>;
  /** Local provider accepted the turn; distinct from Cloud user publication. */
  onTurnAccepted?: (sessionId: string) => void | Promise<void>;
  onPushed?: () => void;
}

interface RunConversationTurnResult {
  runnerSessionId: string;
  pushedEventCount: number;
  pushedAgentEventCount: number;
  tailPublicationPending: boolean;
  terminalStatus: TurnTerminalStatus;
  turnIntentId: string;
}

export async function runConversationTurn(
  params: RunConversationTurnParams
): Promise<RunConversationTurnResult> {
  const turnIntentId = params.turnIntentId ?? mintTurnIntentId();
  const root =
    params.executionRoot ??
    ({
      authority: "org2-cloud",
      authorityScope: [params.orgId],
      conversationId: params.rootSessionId,
    } as const);
  log.info(
    `resolved execution for ${params.orgId}:${params.rootSessionId}; ` +
      `selected=${params.target.cliAgentType ?? "native"}`
  );

  // The idempotent conversation-plane push already published the user event.
  // Native materialization may proceed without a second wire path.
  const beforeDispatch = async () => undefined;
  let result: Awaited<ReturnType<typeof continueLocalConversation>>;
  try {
    const continuationParams = {
      root,
      title: params.conversationTitle,
      timeline: params.timeline,
      displayText: params.displayText,
      agentContent: params.agentContent,
      imageDataUrls: params.imageDataUrls,
      target: params.target,
      turnIntentId,
      beforeDispatch,
      // Bind the root surface to the hidden execution immediately. The
      // maximum prefix suppresses history overlay until materialization
      // reports the exact native boundary through onSessionReady below.
      onSessionPreparing: (sessionId: string) =>
        params.onRunnerReady?.(
          sessionId,
          turnIntentId,
          Number.MAX_SAFE_INTEGER
        ),
      onSessionReady: (sessionId: string, eventStartIndex: number) =>
        params.onRunnerReady?.(sessionId, turnIntentId, eventStartIndex),
      onTurnAccepted: params.onTurnAccepted,
    };
    const recovered = params.recovery
      ? await recoverLocalConversationTurn({
          ...continuationParams,
          runnerSessionId: params.recovery.runnerSessionId,
          eventStartIndex: params.recovery.eventStartIndex,
        })
      : null;
    result = recovered ?? (await continueLocalConversation(continuationParams));
  } catch (error) {
    // The human message is already a successful Cloud-plane event. If the
    // local runtime then fails during create/materialize/send, publish one
    // ordinary transcript error beside it; otherwise the shared root looks
    // permanently unanswered after its transient runner overlay disappears.
    try {
      const failureEvents = await conversationEventsForPush(
        buildPushedDispatchFailureEvent(
          error,
          new Date().toISOString(),
          turnIntentId
        )
      );
      const stagedIds = await stageConversationTail({
        authIdentityKey: params.authIdentityKey,
        orgId: params.orgId,
        rootSessionId: params.rootSessionId,
        turnId: turnIntentId,
        batchId: "failure",
        events: failureEvents,
      });
      const drained = await drainConversationTailOutbox({
        authIdentityKey: params.authIdentityKey,
        getAccessToken: params.getAccessToken,
        onPushed: () => params.onPushed?.(),
      });
      const unresolved = new Set([
        ...drained.failedChunkIds,
        ...drained.pendingChunkIds,
      ]);
      if (stagedIds.some((id) => unresolved.has(id))) {
        throw new Error("Cloud did not durably publish the turn failure");
      }
    } catch (publishError) {
      log.warn(
        `failed to publish execution error for ${params.orgId}:${params.rootSessionId}`,
        publishError
      );
      throw publishError;
    }
    throw error;
  }

  const terminalTail =
    result.terminalStatus === "failed" && result.agentTail.length === 0
      ? [
          buildPushedDispatchFailureEvent(
            new Error("Agent request failed"),
            new Date().toISOString(),
            turnIntentId
          ),
        ]
      : result.agentTail;
  const agentTail = (
    await Promise.all(terminalTail.map(conversationEventsForPush))
  ).flat();
  let pushedAgentEventCount = 0;
  let tailPublicationPending = false;
  if (agentTail.length > 0) {
    // Staging is the crash-consistency boundary. If local durable storage
    // fails, propagate the error so the accepted canonical queue row
    // remains and restart recovery can re-read this exact native tail.
    const stagedIds = await stageConversationTail({
      authIdentityKey: params.authIdentityKey,
      orgId: params.orgId,
      rootSessionId: params.rootSessionId,
      turnId: turnIntentId,
      batchId: "agent",
      events: agentTail,
    });
    try {
      const drained = await drainConversationTailOutbox({
        authIdentityKey: params.authIdentityKey,
        getAccessToken: params.getAccessToken,
        onPushed: () => params.onPushed?.(),
      });
      const staged = new Set(stagedIds);
      pushedAgentEventCount = drained.pushedChunks
        .filter((chunk) => staged.has(chunk.id))
        .reduce((total, chunk) => total + chunk.eventCount, 0);
      const unresolved = new Set([
        ...drained.failedChunkIds,
        ...drained.pendingChunkIds,
      ]);
      tailPublicationPending = stagedIds.some((id) => unresolved.has(id));
      if (stagedIds.some((id) => drained.failedChunkIds.includes(id))) {
        throw new Error(
          "Cloud permanently rejected a staged provider tail; keeping its accepted queue row for visible recovery"
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Cloud permanently rejected")
      ) {
        throw error;
      }
      // The provider turn and outbox row are both durable. Keep the episode
      // overlaid and let ordinary outbox drain retry after connectivity or
      // auth recovers; no provider replay is needed.
      tailPublicationPending = true;
      log.warn(
        `network drain deferred for ${agentTail.length} durably staged tail event(s) for ${params.orgId}:${params.rootSessionId}`,
        error
      );
    }
  }
  log.info(
    `continued ${params.orgId}:${params.rootSessionId} in ${result.sessionId}; ` +
      `pushed 1 + ${pushedAgentEventCount} event(s)` +
      (tailPublicationPending ? "; tail pending durable retry" : "")
  );
  return {
    runnerSessionId: result.sessionId,
    pushedEventCount: 1 + pushedAgentEventCount,
    pushedAgentEventCount,
    tailPublicationPending,
    terminalStatus: result.terminalStatus,
    turnIntentId,
  };
}
