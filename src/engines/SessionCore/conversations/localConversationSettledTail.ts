/**
 * Settled-tail recovery for one conversation turn: after the durable terminal,
 * slice the newly appended agent/tool events out of the target-native episode
 * and keep EventStore's projection aligned with the synchronized transcript.
 */
import type { TurnTerminalStatus } from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isInternalLifecycleEvent } from "@src/engines/SessionCore/ingestion/visibilityFilters";
import {
  reconcileNativeTranscript,
  recoverNativeTranscriptAfterMismatch,
} from "@src/engines/SessionCore/sync/nativeTranscriptReconcile";
import { createLogger } from "@src/hooks/logger";

import {
  CONVERSATION_TURN_ID_ARG,
  type ProviderRequestIdentity,
  conversationTurnIdOf,
  nativeUserMessageMatchesRequest,
} from "./localConversationTurnIdentity";
import {
  nativeConversationItemsArePrefix,
  nativeSourceEventId,
  projectNativeConversationItems,
  removeKnownNativeConversationEchoes,
  sourceEventIdOfNativeItem,
} from "./nativeConversationMaterializer";
import {
  isNativeTerminalDiagnosticOrEcho,
  nativeTerminalDiagnosticSources,
} from "./nativeTerminalDiagnostic";
import { QueuedConversationRecoveryPendingError } from "./queuedConversationContract";

const log = createLogger("localConversationContinuation");

/**
 * Keep EventStore's render/cache projection aligned after a target-native
 * episode has been synchronized from the canonical SessionEvent log. The
 * provider file is only that episode's execution format; the verified
 * canonical projection remains the conversation authority.
 */
export async function hydrateSynchronizedConversationProjection(
  sessionId: string,
  before: readonly SessionEvent[],
  after: readonly SessionEvent[]
): Promise<void> {
  if (before.length === after.length && sameEventPrefix(before, after)) return;
  if (sameEventPrefix(before, after)) {
    await eventStoreProxy.mergeEvents(after.slice(before.length), sessionId);
    return;
  }
  await eventStoreProxy.set([...after], sessionId);
}

function sameEventPrefix(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[]
): boolean {
  return (
    before.length <= after.length &&
    before.every((event, index) => event.id === after[index]?.id)
  );
}

function sliceTurnTail(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[],
  turnIntentId: string
): SessionEvent[] | null {
  let appended: readonly SessionEvent[];
  if (sameEventPrefix(before, after)) {
    appended = after.slice(before.length);
    const anchor = appended.findIndex(
      (event) =>
        event.source === "user" && conversationTurnIdOf(event) === turnIntentId
    );
    if (anchor < 0) return null;
    appended = appended.slice(anchor + 1);
  } else {
    const anchor = after.findIndex(
      (event) =>
        event.source === "user" && conversationTurnIdOf(event) === turnIntentId
    );
    if (anchor < 0) return null;
    appended = after.slice(anchor + 1);
  }
  return removeKnownNativeConversationEchoes(
    before,
    appended.filter((event) => event.source !== "user")
  );
}

/**
 * Provider-native transcripts cannot be required to persist ORG2's private
 * turn-intent id. After terminal, recover the structured native suffix by
 * proving that the complete pre-turn portable transcript is still an exact
 * semantic prefix, then locating the newly appended user message. This is a
 * role/tool transcript comparison; no history is rendered into a prompt.
 */
function sliceProviderNativeTail(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[],
  turnIntentId: string,
  expectedRequest: ProviderRequestIdentity,
  logMismatch = true
): SessionEvent[] | null {
  const beforeItems = projectNativeConversationItems(before);
  const afterItems = projectNativeConversationItems(after);
  if (!nativeConversationItemsArePrefix(beforeItems, afterItems)) {
    if (logMismatch) {
      log.warn(
        `[native-continuation] native semantic prefix mismatch: before=${beforeItems.length}, after=${afterItems.length}`
      );
    }
    return null;
  }

  const appendedItems = afterItems.slice(beforeItems.length);
  const userIndex = appendedItems.findIndex(
    (item) =>
      item.kind === "message" &&
      item.role === "user" &&
      (item.turnId === turnIntentId ||
        nativeUserMessageMatchesRequest(item, expectedRequest))
  );
  if (userIndex < 0) {
    if (logMismatch) {
      log.warn(
        `[native-continuation] native suffix has no matching user anchor: appended=${appendedItems.length}`
      );
    }
    return null;
  }

  const tailEventIds = new Set(
    appendedItems.slice(userIndex + 1).map(sourceEventIdOfNativeItem)
  );
  if (tailEventIds.size === 0) return [];
  const tail = after.filter(
    (event) =>
      event.source !== "user" && tailEventIds.has(nativeSourceEventId(event))
  );
  // The canonical user timestamp may predate a queued/retried native send.
  // Preserve the provider's actual user-append boundary using the existing
  // lifecycle event, which is excluded from native role/tool materialization.
  const nativeUser = appendedItems[userIndex];
  if (tail.length > 0 && Number.isFinite(Date.parse(nativeUser.createdAt))) {
    const id = `convturn-${turnIntentId}-native-start`;
    tail.unshift({
      id,
      chunk_id: id,
      sessionId: tail[0].sessionId,
      createdAt: nativeUser.createdAt,
      functionName: "task_start",
      uiCanonical: "task_start",
      actionType: "task_start",
      source: "system",
      args: { [CONVERSATION_TURN_ID_ARG]: turnIntentId },
      result: { turnIntentId },
      displayText: "",
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "processed",
      payloadRefs: [],
    });
  }
  log.info(
    `[native-continuation] recovered provider-native tail: items=${tailEventIds.size}, events=${tail.length}`
  );
  return tail;
}

function resolveSettledTail(
  before: readonly SessionEvent[],
  events: readonly SessionEvent[],
  turnIntentId: string,
  expectedRequest: ProviderRequestIdentity,
  logMismatch: boolean
): SessionEvent[] | null {
  const identifiedTail = sliceTurnTail(before, events, turnIntentId);
  // Native readers retain task_completed/task_failed after the user anchor,
  // even when the provider emitted no reply. Those execution receipts alone
  // must not make a failed turn look answered and retire its Retry owner.
  // Keep tool, private reasoning, partial replies and ordinary errors; only
  // lifecycle/typed-terminal-receipt tails fall through to portable-prefix
  // proof. Raw retry proof separately checks the matching failed native turn.
  const diagnosticSources = nativeTerminalDiagnosticSources(events);
  if (
    identifiedTail?.some(
      (event) =>
        !isInternalLifecycleEvent(event) &&
        !isNativeTerminalDiagnosticOrEcho(event, diagnosticSources)
    )
  ) {
    return identifiedTail;
  }
  return sliceProviderNativeTail(
    before,
    events,
    turnIntentId,
    expectedRequest,
    logMismatch
  );
}

export async function loadSettledTail(
  sessionId: string,
  before: readonly SessionEvent[],
  turnIntentId: string,
  expectedRequest: ProviderRequestIdentity,
  terminalStatus: TurnTerminalStatus
): Promise<{ agentTail: SessionEvent[]; events: SessionEvent[] }> {
  const preserveInterruptedSuffix =
    terminalStatus === "cancelled" || terminalStatus === "failed";
  const reconcileOptions = {
    preserveInterruptedSuffix,
  };
  let events = await reconcileNativeTranscript(sessionId, reconcileOptions);
  let agentTail = resolveSettledTail(
    before,
    events,
    turnIntentId,
    expectedRequest,
    false
  );
  if (agentTail) return { agentTail, events };
  if (terminalStatus === "failed") {
    // A CLI can exit before recording the prompt (for example, a rejected
    // resume ID). Its durable terminal is authoritative, but a cached replay
    // alone is not proof that it wrote nothing. Force the existing mismatch
    // recovery once before accepting an unchanged portable history.
    events = await recoverNativeTranscriptAfterMismatch(
      sessionId,
      events,
      (candidate) =>
        resolveSettledTail(
          before,
          candidate,
          turnIntentId,
          expectedRequest,
          false
        ) !== null,
      reconcileOptions
    );
    agentTail = resolveSettledTail(
      before,
      events,
      turnIntentId,
      expectedRequest,
      true
    );
    if (agentTail) return { agentTail, events };
    const beforeItems = projectNativeConversationItems(before);
    const afterItems = projectNativeConversationItems(events);
    if (
      beforeItems.length === afterItems.length &&
      nativeConversationItemsArePrefix(beforeItems, afterItems)
    ) {
      // The canonical user row already exists. An empty FAILED tail goes
      // through the ordinary failure publisher; it is never a success and
      // must not leave an execution retrying an impossible native anchor.
      return { agentTail: [], events };
    }
  }
  if (preserveInterruptedSuffix) {
    if (providerClosedTurnWithoutRecordingPrompt(before, events)) {
      // Stop reached the provider before it persisted the prompt: the native
      // transcript gained only the turn's closing lifecycle marker and no
      // portable item. Nothing further will converge, so this is the same
      // durable empty-tail boundary as a user-only interrupted turn. The
      // accepted user row stays on the canonical timeline for the next send.
      log.warn(
        `[native-continuation] ${turnIntentId} was interrupted before the provider recorded its prompt; settling an empty tail`
      );
      return { agentTail: [], events };
    }
    // `resolveSettledTail` returns [] (which is truthy) when the provider
    // transcript contains the accepted user anchor but no assistant/tool
    // output. `null` is materially different: the accepted turn has not yet
    // converged into the native transcript/EventStore projection. Keep the
    // durable queue item recovery-pending rather than publishing a false
    // empty-tail success and losing the user's interrupted turn on rollover.
    throw new QueuedConversationRecoveryPendingError(
      `conversation turn ${turnIntentId} is missing its interrupted native transcript anchor`
    );
  }

  // Backend terminal publication normally makes the first read complete.
  // Retry only after this concrete semantic mismatch, never as a fixed delay
  // in every queued turn's critical path.
  events = await recoverNativeTranscriptAfterMismatch(
    sessionId,
    events,
    (candidate) =>
      resolveSettledTail(
        before,
        candidate,
        turnIntentId,
        expectedRequest,
        false
      ) !== null,
    reconcileOptions
  );
  agentTail = resolveSettledTail(
    before,
    events,
    turnIntentId,
    expectedRequest,
    true
  );
  if (agentTail) return { agentTail, events };
  throw new Error(
    `conversation turn ${turnIntentId} is missing its native transcript anchor`
  );
}

const TURN_CLOSING_LIFECYCLE_ACTIONS = new Set([
  "task_completed",
  "task_failed",
]);

/**
 * True when the provider transcript grew past the pre-turn prefix only by a
 * closing task lifecycle marker: the provider finalized (aborted) the turn
 * without ever recording the prompt or any portable output. The portable item
 * list is unchanged, so no user anchor can appear later.
 */
export function providerClosedTurnWithoutRecordingPrompt(
  before: readonly SessionEvent[],
  after: readonly SessionEvent[]
): boolean {
  const beforeItems = projectNativeConversationItems(before);
  const afterItems = projectNativeConversationItems(after);
  if (
    afterItems.length !== beforeItems.length ||
    !nativeConversationItemsArePrefix(beforeItems, afterItems)
  ) {
    return false;
  }
  const knownIds = new Set(before.map((event) => event.id));
  return after.some(
    (event) =>
      !knownIds.has(event.id) &&
      TURN_CLOSING_LIFECYCLE_ACTIONS.has(event.actionType)
  );
}
