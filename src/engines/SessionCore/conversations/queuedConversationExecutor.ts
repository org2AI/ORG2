import type { Store } from "jotai/vanilla/store";

import type { TurnTerminalStatus } from "@src/engines/SessionCore/control/turnLifecycle";

import type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "./conversationTypes";

export interface QueuedConversationDispatch {
  kind: "canonical_conversation";
  /** Typed provider-neutral identity; all native execution episodes share it. */
  root: ConversationRootLocator;
  /** Runtime/account/model/workspace frozen when the user pressed Send. */
  target: LocalConversationTarget;
  /** Non-secret sender/account identity frozen at admission for remote roots. */
  dispatchIdentityKey?: string;
}

/** Neutral subset consumed by a canonical authority executor. */
export interface QueuedConversationMessage {
  id: string;
  turnIntentId: string;
  sessionId: string;
  content: string;
  displayContent: string;
  imageDataUrls?: string[];
  status: "queued" | "preparing" | "accepted";
  runnerSessionId?: string;
  runnerEventStartIndex?: number;
  conversationDispatch?: QueuedConversationDispatch;
}

/** Lifecycle boundaries exposed by the existing durable message queue. */
export interface QueuedConversationDispatchCallbacks {
  /** Provider accepted the turn; persist `accepted` on the same queue row. */
  onAccepted: (runnerSessionId: string) => void | Promise<void>;
  /** A writable native execution episode is ready for presentation. */
  onRunnerReady?: (
    runnerSessionId: string,
    eventStartIndex: number
  ) => void | Promise<void>;
}

export interface QueuedConversationExecutionResult {
  terminalStatus: TurnTerminalStatus;
}

/** Another window currently owns this canonical root; keep the row queued. */
export class QueuedConversationBusyError extends Error {
  constructor() {
    super("canonical conversation is running in another window");
    this.name = "QueuedConversationBusyError";
  }
}

/**
 * Dependency-inversion seam for canonical-conversation delivery.
 *
 * SessionCore continues to own the only durable queue. Feature composition
 * supplies the provider/cloud adapter without making the queue depend on UI
 * or Cloud modules.
 */
export type QueuedConversationExecutor = (
  store: Store,
  message: QueuedConversationMessage,
  callbacks: QueuedConversationDispatchCallbacks
) => Promise<QueuedConversationExecutionResult>;
