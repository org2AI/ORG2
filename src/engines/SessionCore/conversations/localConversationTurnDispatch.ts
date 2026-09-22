/**
 * Turn dispatch for one local execution episode: prepare the shared user
 * intent, create/materialize a fresh episode when needed, hand the turn to the
 * provider, and wait for its durable terminal plus settled tail.
 */
import { rpc } from "@src/api/tauri/rpc";
import {
  type TurnTerminalStatus,
  toTurnTerminalStatus,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import {
  type UserIntentPreparation,
  UserIntentSendError,
  activateUserIntentPreparation,
  confirmUserIntentPreparation,
  dispatchUserIntent,
  failUserIntentPreparation,
  isUserIntentSendError,
  optimisticQueueUserEventId,
  prepareUserIntent,
  settleUserIntentLifecycle,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { createLogger } from "@src/hooks/logger";

import type { LocalConversationTarget } from "./conversationTypes";
import type {
  ContinueLocalConversationParams,
  ContinueLocalConversationResult,
  ConversationTurnPreparation,
} from "./localConversationContinuationTypes";
import { conversationExecutionParentId } from "./localConversationExecutionIdentity";
import { loadSettledTail } from "./localConversationSettledTail";
import {
  type ProviderRequestIdentity,
  conversationTurnIdOf,
} from "./localConversationTurnIdentity";
import {
  materializeNativeConversation,
  supportsNativeConversationTarget,
} from "./nativeConversationMaterializer";
import { QueuedConversationRecoveryPendingError } from "./queuedConversationContract";

const TURN_WAIT_WINDOW_MS = 60_000;
const log = createLogger("localConversationContinuation");

export function isCodexNativeEpisodeAlreadyOwned(
  error: unknown,
  target: LocalConversationTarget
): boolean {
  if (target.cliAgentType !== "codex") return false;

  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }
    messages.push(String(current));
    break;
  }
  const message = messages.join("\n").toLowerCase();
  return (
    message.includes("-32600") &&
    message.includes("thread/resume") &&
    message.includes("already has an active writer")
  );
}

export async function notifyConversationTurnAccepted(
  callback: ContinueLocalConversationParams["onTurnAccepted"],
  sessionId: string,
  turnIntentId: string
): Promise<void> {
  if (!callback) return;
  try {
    await callback(sessionId);
  } catch (error) {
    log.error(
      `[native-continuation] failed to persist acceptance receipt for ${turnIntentId}`,
      error
    );
    // Provider acceptance is already irreversible. The durable queue must
    // retain this exact owner and reconnect by turnIntentId; continuing as if
    // bookkeeping succeeded would silently strand a running native turn and
    // make a later retry eligible to send twice.
    throw new QueuedConversationRecoveryPendingError(
      `provider accepted ${turnIntentId}, but its durable receipt could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function waitForTurnTerminal(
  sessionId: string,
  turnIntentId: string
): Promise<TurnTerminalStatus> {
  for (;;) {
    try {
      const terminal = await rpc.sessionCore.turnIntents.waitForTerminal({
        sessionId,
        turnIntentId,
        timeoutMs: TURN_WAIT_WINDOW_MS,
      });
      log.info(
        `[native-continuation] durable turn intent ${turnIntentId}: ${terminal.status}`
      );
      return toTurnTerminalStatus(terminal.status);
    } catch (error) {
      // A bounded long-poll timeout is not a turn timeout. Re-read the exact
      // durable row and open another window while the provider owns it.
      const current = await rpc.sessionCore.turnIntents.status({
        sessionId,
        turnIntentId,
      });
      if (
        current &&
        ["optimistic", "queued", "running"].includes(current.status)
      ) {
        continue;
      }
      if (current) {
        return toTurnTerminalStatus(current.status);
      }
      throw error;
    }
  }
}

export async function finishConversationTurn(params: {
  sessionId: string;
  before: readonly SessionEvent[];
  turnIntentId: string;
  providerRequest: ProviderRequestIdentity;
  generation: number;
  /** Recovery created this frontend lifecycle after provider acceptance. */
  settleAdoptedLifecycle?: boolean;
}): Promise<
  Pick<ContinueLocalConversationResult, "terminalStatus" | "agentTail">
> {
  const terminalStatus = await waitForTurnTerminal(
    params.sessionId,
    params.turnIntentId
  );
  // Keep the exact turn generation active until its authoritative tail is in
  // EventStore. Releasing the FSM at the durable provider terminal would let
  // the ordinary Session queue inject a follow-up against a stale transcript.
  const settled = await loadSettledTail(
    params.sessionId,
    params.before,
    params.turnIntentId,
    params.providerRequest,
    terminalStatus
  );
  // Fresh sends are closed only by the CLI/Agent lifecycle coordinator.
  // Crash recovery created a synthetic frontend lifecycle after the original
  // terminal event, so it alone closes that adopted generation here.
  if (params.settleAdoptedLifecycle) {
    settleUserIntentLifecycle(params, terminalStatus);
  }
  return {
    terminalStatus,
    agentTail: settled.agentTail,
  };
}

export async function prepareConversationTurn(
  sessionId: string,
  params: Pick<
    ContinueLocalConversationParams,
    "displayText" | "imageDataUrls" | "turnIntentId" | "root" | "queueMessageId"
  >,
  runtimeStatusSource: UserIntentPreparation["runtimeStatusSource"]
): Promise<ConversationTurnPreparation> {
  // EventStore deduplicates user rows by turn intent. When the root itself
  // executes, reuse its queue row instead of preparing a second id that the
  // store will discard. A separate native episode owns a separate projection.
  const queueMessageId =
    params.root.authority === "local-session" &&
    params.root.conversationId === sessionId
      ? params.queueMessageId
      : undefined;
  return prepareUserIntent({
    sessionId,
    queueMessageId,
    userEventId: queueMessageId
      ? optimisticQueueUserEventId(queueMessageId)
      : undefined,
    visibleText: params.displayText,
    imageDataUrls: params.imageDataUrls,
    turnIntentId: params.turnIntentId,
    runtimeStatusSource,
  });
}

export async function dispatchConversationMessage(
  sessionId: string,
  params: Omit<ContinueLocalConversationParams, "timeline">,
  options: {
    allowNativeContextRecovery: boolean;
    runtimeStatusSource: UserIntentPreparation["runtimeStatusSource"];
    preparation?: ConversationTurnPreparation;
  }
): ReturnType<typeof dispatchUserIntent> {
  return dispatchUserIntent({
    sessionId,
    visibleText: params.displayText,
    imageDataUrls: params.imageDataUrls,
    runtimeStatusSource: options.runtimeStatusSource,
    preparation: options.preparation,
    send: {
      content: params.agentContent ?? params.displayText,
      displayText: params.displayText,
      model: params.target.model,
      accountId: params.target.accountId,
      mode: params.mode ?? "build",
      clientMessageId: `conversation-turn:${params.turnIntentId}`,
      turnIntentId: params.turnIntentId,
      turnIntentSource: "user_submit",
      directUserIntent: true,
      allowNativeContextRecovery: options.allowNativeContextRecovery,
    },
  });
}

async function createConversationExecution(
  params: Pick<
    ContinueLocalConversationParams,
    "root" | "title" | "target" | "mode"
  >
): Promise<{ sessionId: string }> {
  return SessionService.create({
    task: "",
    name: params.title,
    repoPath: params.target.workspaceRepoPath ?? undefined,
    model: params.target.model,
    accountId: params.target.accountId,
    credentialSource: params.target.credentialSource,
    cliAgentType: params.target.cliAgentType,
    keySource: "own_key",
    agentDefinitionId: params.target.agentDefinitionId,
    parentSessionId: conversationExecutionParentId(params.root),
    mode: params.mode ?? "build",
  });
}

async function materializeCreatedConversation(
  sessionId: string,
  params: Pick<ContinueLocalConversationParams, "timeline">
) {
  // SessionEvent is the sole conversation authority. Even when the imported
  // source and target happen to be the same provider, a new execution episode
  // is rebuilt from the canonical role/tool event list instead of adopting a
  // provider file. This guarantees Team Chat and turns produced by every
  // other runtime participate in exactly the same target-native transcript.
  return materializeNativeConversation({
    sessionId,
    timeline: params.timeline,
  });
}

interface CreatedConversationOptions {
  loadTimeline: () => Promise<readonly SessionEvent[]>;
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
}

export async function runCreatedConversationTurn(
  params: Omit<ContinueLocalConversationParams, "timeline">,
  options: CreatedConversationOptions
): Promise<ContinueLocalConversationResult> {
  const created = await createConversationExecution(params);
  let materialized:
    | Awaited<ReturnType<typeof materializeCreatedConversation>>
    | undefined;
  // Keep ownership of the eager visible preparation while launch is still
  // pending. If session_launch rejects (bad OAuth, offline CLI, etc.), close
  // that exact generation immediately instead of leaving the composer to the
  // dispatching dead-man.
  let preparation: ConversationTurnPreparation | null = null;
  try {
    preparation = await prepareConversationTurn(
      created.sessionId,
      params,
      "launch"
    );
    // Native transcript conversion can take materially longer than provider
    // startup. Promote preparation out of the dispatch dead-man while keeping
    // the same shared direct-turn lifecycle used by ordinary composer sends.
    confirmUserIntentPreparation(preparation);
    await options.onSessionCreated?.(created.sessionId);
    activateUserIntentPreparation(preparation);
    const timeline = (await options.loadTimeline()).filter(
      (event) => conversationTurnIdOf(event) !== params.turnIntentId
    );
    materialized = await materializeCreatedConversation(created.sessionId, {
      timeline,
    });
    // CLI native files are outside EventStore, so seed their verified replay
    // for an immediate first render. Rust Agent materialization already
    // hydrates its own EventStore; setting the same rows here would duplicate
    // each user message under the Agent history adapter's normalized id.
    if (params.target.cliAgentType) {
      await eventStoreProxy.set(
        [...materialized.events, preparation.userEvent],
        created.sessionId
      );
    }
    await params.onSessionReady?.(
      created.sessionId,
      materialized.events.length
    );
    await params.onBeforeTurnDispatch?.(created.sessionId);
    const dispatched = await dispatchConversationMessage(
      created.sessionId,
      params,
      {
        // A fresh episode was rebuilt from the canonical role/tool list, so
        // provider-native compact/rollover may recover a target-window limit.
        allowNativeContextRecovery: true,
        runtimeStatusSource: "launch",
        preparation,
      }
    );
    preparation = dispatched.preparation;
  } catch (error) {
    log.error(
      `[localConversationContinuation] launch turn failed for ${created.sessionId}:`,
      error
    );
    if (preparation) {
      if (error instanceof QueuedConversationRecoveryPendingError) throw error;
      await failUserIntentPreparation(preparation, error).catch(
        () => undefined
      );
      throw isUserIntentSendError(error)
        ? error
        : new UserIntentSendError(error, preparation.userEvent.id);
    }
    throw error;
  }

  await notifyConversationTurnAccepted(
    params.onTurnAccepted,
    created.sessionId,
    params.turnIntentId
  );

  if (!materialized) {
    throw new Error("conversation materialization completed without a receipt");
  }
  if (!preparation) {
    throw new Error("conversation dispatch completed without a preparation");
  }

  const finished = await finishConversationTurn({
    sessionId: created.sessionId,
    before: materialized.events,
    turnIntentId: params.turnIntentId,
    providerRequest: {
      text: params.agentContent ?? params.displayText,
      images: params.imageDataUrls ?? [],
    },
    generation: preparation.generation,
  });
  return {
    sessionId: created.sessionId,
    terminalStatus: finished.terminalStatus,
    agentTail: finished.agentTail,
  };
}

export function assertSupportedConversationTarget(
  target: LocalConversationTarget
): void {
  if (!supportsNativeConversationTarget(target)) {
    throw new Error(
      `target ${target.cliAgentType ?? "native"} cannot materialize a provider-native role/tool transcript`
    );
  }
}
