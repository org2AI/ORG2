/**
 * Parameter and result contracts for provider-neutral local continuation.
 * Shared by the continuation entry points and their dispatch helpers so no
 * helper module has to import the entry-point module back.
 */
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import type { TurnTerminalStatus } from "@src/engines/SessionCore/control/turnLifecycle";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { UserIntentPreparation } from "@src/engines/SessionCore/services/userIntentDispatch";

import type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "./conversationTypes";

export interface ContinueLocalConversationParams {
  /** Selected execution policy; legacy/cloud callers retain Build by default. */
  mode?: AgentExecMode;
  root: ConversationRootLocator;
  title: string;
  /** Canonical transcript immediately before this new user turn. */
  timeline: readonly SessionEvent[];
  displayText: string;
  agentContent?: string;
  imageDataUrls?: string[];
  target: LocalConversationTarget;
  turnIntentId: string;
  /** Queue projection on the canonical root, reused when that root executes. */
  queueMessageId?: string;
  onSessionReady?: (
    sessionId: string,
    /** Authoritative native-event prefix that predates this turn. */
    eventStartIndex: number
  ) => void | Promise<void>;
  /**
   * Last reversible boundary before the selected provider receives the turn.
   * Cloud authority uses it to durably mark a cross-device lease accepted;
   * recovery also invokes it when an older local receipt proves the provider
   * already crossed that boundary. Local conversations leave it unset.
   */
  onBeforeTurnDispatch?: (sessionId: string) => void | Promise<void>;
  /**
   * Fires once the selected provider has durably accepted this user turn.
   * Queue ownership lives above the continuation adapter: callers use this
   * boundary to remove the durable queue row while the native turn keeps
   * running and reconciling in the background.
   */
  onTurnAccepted?: (sessionId: string) => void | Promise<void>;
  /**
   * A fresh episode now owns preparation, before its canonical transcript has
   * finished materializing. Surfaces use this to bind the ordinary planning
   * footer immediately without overlaying historical events.
   */
  onSessionPreparing?: (sessionId: string) => void | Promise<void>;
}

export interface ContinueLocalConversationAfterTimelineLoadParams extends Omit<
  ContinueLocalConversationParams,
  "timeline"
> {
  /**
   * Read the authoritative canonical transcript only after this conversation
   * reaches the head of the singleton message queue. This prevents a submit made
   * immediately after Stop from racing the previous turn's native-tail
   * reconciliation and materializing a stale prefix into the next runtime.
   */
  loadTimeline: () => Promise<readonly SessionEvent[]>;
}

export interface ContinueLocalConversationResult {
  sessionId: string;
  terminalStatus: TurnTerminalStatus;
  agentTail: SessionEvent[];
}

export interface RecoverLocalConversationParams extends ContinueLocalConversationParams {
  runnerSessionId: string;
  eventStartIndex?: number;
}

export type ConversationTurnPreparation = UserIntentPreparation;
