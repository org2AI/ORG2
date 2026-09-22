/**
 * Pure transforms and types for `useCloudChannelMessages`: the transcript's
 * sort/merge rules, optimistic-row helpers, capability probes, and the
 * state/option shapes the hook returns.
 */
import type { CloudChannelMessage } from "./channelMessagesTypes";

/** Quiet window before the read cursor is written. */
export const CHANNEL_READ_CURSOR_DEBOUNCE_MS = 800;

/** Optimistic rows carry this prefix so a refusal can roll exactly them back. */
export const OPTIMISTIC_MESSAGE_ID_PREFIX = "pending:";

export type CloudChannelMessagesPhase =
  | "signedOut"
  | "loading"
  | "unsupported"
  | "error"
  | "ready";

export interface CloudChannelMessagesState {
  phase: CloudChannelMessagesPhase;
  /** Ascending by `createdAt` — the transcript's render order. */
  messages: CloudChannelMessage[];
  error: string | null;
  /** An initial/refresh page read is in flight. */
  refreshing: boolean;
  loadingOlder: boolean;
  /** A previous page exists behind the current one. */
  hasOlder: boolean;
  unreadCount: number;
  loadOlder: () => void;
  /** Resolves on success; REJECTS with the RPC error so the draft survives. */
  postMessage: (body: string) => Promise<void>;
  editMessage: (messageId: string, body: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  /** Debounced read-cursor write; the hook also calls it on new rows. */
  markRead: () => void;
  currentUserId: string | null;
}

export interface CloudChannelMessagesOptions {
  /** Injectable for tests; defaults to `CHANNEL_READ_CURSOR_DEBOUNCE_MS`. */
  readCursorDebounceMs?: number;
}

/**
 * `orgChannelMessages` joins `CloudCapabilities` with the message migration;
 * read it structurally so an absent flag ⇒ unsupported against older probe
 * shapes (and so the panel keeps its honest gate on those backends).
 */
export function hasOrgChannelMessagesCapability(
  capabilities: unknown
): boolean {
  return Boolean(
    capabilities &&
    typeof capabilities === "object" &&
    (capabilities as { orgChannelMessages?: unknown }).orgChannelMessages ===
      true
  );
}

/**
 * `orgChannelMessagesIdempotency` joins with the 0016 migration: only a
 * backend that advertises it accepts `p_client_key`, so the post path must
 * gate on this flag — an older backend rejects the unknown argument.
 */
export function hasOrgChannelMessagesIdempotencyCapability(
  capabilities: unknown
): boolean {
  return Boolean(
    capabilities &&
    typeof capabilities === "object" &&
    (capabilities as { orgChannelMessagesIdempotency?: unknown })
      .orgChannelMessagesIdempotency === true
  );
}

/** Ascending by `createdAt`, id as the stable tiebreaker. */
export function sortChannelMessages(
  messages: readonly CloudChannelMessage[]
): CloudChannelMessage[] {
  return [...messages].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * Merge server rows into the loaded transcript by id.
 *
 * Delta rows are the SAME rows in a newer state, so an edit and a tombstone
 * both arrive as a replacement of an already-rendered id. `stateChangedAt` is
 * the LWW key: a delayed older copy of a row never overwrites a newer one
 * (the optimistic-post reply racing its own delta is exactly that case).
 */
export function mergeChannelMessageDelta(
  current: readonly CloudChannelMessage[],
  incoming: readonly CloudChannelMessage[],
  options?: {
    /**
     * Oldest `createdAt` the loaded window is contiguous down to. With older
     * pages still unloaded, an unknown id OLDER than this floor must not
     * merge: it would render above the "load earlier" boundary as if the
     * transcript were contiguous. Known ids always merge (edits/tombstones
     * of loaded rows).
     */
    windowFloor?: string | null;
  }
): CloudChannelMessage[] {
  // Same-identity no-op contract: the serverTime overlap re-ships the
  // trailing window on every delta, and an unchanged transcript must not
  // churn row identities downstream.
  if (incoming.length === 0) return current as CloudChannelMessage[];
  const byId = new Map(current.map((message) => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (existing && existing.stateChangedAt >= message.stateChangedAt) continue;
    if (
      !existing &&
      options?.windowFloor &&
      message.createdAt < options.windowFloor
    ) {
      continue;
    }
    byId.set(message.id, message);
    // Echo of an in-flight post (0016 `clientKey`): a realtime delta can
    // deliver the server row before the post RPC resolves; without this the
    // transcript renders the same message twice until the ack lands.
    if (message.clientKey && !isOptimisticChannelMessageId(message.id)) {
      for (const [id, row] of byId) {
        if (
          isOptimisticChannelMessageId(id) &&
          row.clientKey === message.clientKey
        ) {
          byId.delete(id);
        }
      }
    }
    changed = true;
  }
  if (!changed) return current as CloudChannelMessage[];
  return sortChannelMessages([...byId.values()]);
}

export function isOptimisticChannelMessageId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_MESSAGE_ID_PREFIX);
}

export function createOptimisticMessage(input: {
  channelId: string;
  body: string;
  authorUserId: string;
  authorDisplayName?: string;
  authorAvatarUrl?: string;
  clientKey?: string;
}): CloudChannelMessage {
  const now = new Date().toISOString();
  return {
    id: `${OPTIMISTIC_MESSAGE_ID_PREFIX}${crypto.randomUUID()}`,
    channelId: input.channelId,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName,
    authorAvatarUrl: input.authorAvatarUrl,
    body: input.body,
    createdAt: now,
    editedAt: null,
    deletedAt: null,
    clientKey: input.clientKey ?? null,
    stateChangedAt: now,
    mentionedUserIds: [],
  };
}

/** Newest SERVER-acknowledged row; optimistic rows are not read receipts. */
export function newestServerMessageAt(
  messages: readonly CloudChannelMessage[]
): string | null {
  let newest: string | null = null;
  for (const message of messages) {
    if (isOptimisticChannelMessageId(message.id)) continue;
    if (newest === null || message.createdAt > newest) {
      newest = message.createdAt;
    }
  }
  return newest;
}
