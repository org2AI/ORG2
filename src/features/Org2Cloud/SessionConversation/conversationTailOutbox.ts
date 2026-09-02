import { type Store, load } from "@tauri-apps/plugin-store";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";

import {
  CLOUD_CONVERSATION_MAX_EVENTS_PER_PUSH,
  Org2CloudConversationError,
  pushConversationEvents,
} from "../org2CloudConversationEventsClient";

const log = createLogger("ConversationTailOutbox");
const STORE_PATH = "cloud-conversation-tail-outbox.json";
const STORE_KEY = "pendingChunks";
const OUTBOX_LOCK_NAME = "orgii:cloud-conversation-tail-outbox";
const MAX_PENDING_CONVERSATION_TAIL_CHUNKS = 512;
const MAX_DRAIN_CHUNKS_PER_PASS = 64;

interface PendingConversationTailChunk {
  id: string;
  authIdentityKey: string;
  orgId: string;
  rootSessionId: string;
  turnId: string;
  chunkIndex: number;
  events: SessionEvent[];
  createdAt: string;
  failedError?: string;
}

export interface ConversationTailDrainResult {
  pushedChunks: Array<{ id: string; eventCount: number }>;
  failedChunkIds: string[];
  pendingChunkIds: string[];
}

let storePromise: Promise<Store> | null = null;
let fallbackChain: Promise<unknown> = Promise.resolve();

function durableStore(): Promise<Store> {
  storePromise ??= load(STORE_PATH, { defaults: {}, autoSave: false });
  return storePromise;
}

function validRow(value: unknown): value is PendingConversationTailChunk {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingConversationTailChunk>;
  return (
    typeof row.id === "string" &&
    typeof row.authIdentityKey === "string" &&
    typeof row.orgId === "string" &&
    typeof row.rootSessionId === "string" &&
    typeof row.turnId === "string" &&
    Number.isSafeInteger(row.chunkIndex) &&
    Array.isArray(row.events) &&
    row.events.length > 0 &&
    row.events.length <= CLOUD_CONVERSATION_MAX_EVENTS_PER_PUSH &&
    typeof row.createdAt === "string"
  );
}

function isSameStagedRevision(
  current: PendingConversationTailChunk,
  snapshot: PendingConversationTailChunk
): boolean {
  return current.id === snapshot.id && current.createdAt === snapshot.createdAt;
}

async function loadRows(store: Store): Promise<PendingConversationTailChunk[]> {
  // Each webview owns a plugin-store handle. The Web Lock serializes writers,
  // but it does not refresh another webview's cached document; always reload
  // inside the lock before read-modify-write or one window can erase another
  // window's newly staged tail.
  await store.reload();
  const stored = await store.get<unknown>(STORE_KEY);
  return Array.isArray(stored) ? stored.filter(validRow) : [];
}

async function saveRows(
  store: Store,
  rows: readonly PendingConversationTailChunk[]
): Promise<void> {
  await store.set(STORE_KEY, rows);
  await store.save();
}

async function withOutboxLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return await locks.request(
      OUTBOX_LOCK_NAME,
      { mode: "exclusive" },
      operation
    );
  }
  const next = fallbackChain.catch(() => undefined).then(operation);
  fallbackChain = next;
  return await next;
}

/**
 * Persist the normalized tail before its first network attempt. The Cloud RPC
 * is idempotent by event id, so a crash after the RPC but before the local
 * delete safely replays the same chunk after restart.
 */
export async function stageConversationTail(params: {
  authIdentityKey: string;
  orgId: string;
  rootSessionId: string;
  turnId: string;
  batchId: string;
  events: readonly SessionEvent[];
}): Promise<string[]> {
  if (params.events.length === 0) return [];
  const chunkCount = Math.ceil(
    params.events.length / CLOUD_CONVERSATION_MAX_EVENTS_PER_PUSH
  );
  if (chunkCount > MAX_PENDING_CONVERSATION_TAIL_CHUNKS) {
    throw new Error(
      `Cloud conversation tail is too large (${chunkCount}/${MAX_PENDING_CONVERSATION_TAIL_CHUNKS} chunks)`
    );
  }
  const chunks: PendingConversationTailChunk[] = [];
  for (
    let offset = 0, chunkIndex = 0;
    offset < params.events.length;
    offset += CLOUD_CONVERSATION_MAX_EVENTS_PER_PUSH, chunkIndex += 1
  ) {
    chunks.push({
      id: [
        params.authIdentityKey,
        params.orgId,
        params.rootSessionId,
        params.turnId,
        params.batchId,
        chunkIndex,
      ].join("\u001f"),
      authIdentityKey: params.authIdentityKey,
      orgId: params.orgId,
      rootSessionId: params.rootSessionId,
      turnId: params.turnId,
      chunkIndex,
      events: params.events.slice(
        offset,
        offset + CLOUD_CONVERSATION_MAX_EVENTS_PER_PUSH
      ),
      createdAt: new Date().toISOString(),
    });
  }
  await withOutboxLock(async () => {
    const store = await durableStore();
    const rows = await loadRows(store);
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    for (const chunk of chunks) byId.set(chunk.id, chunk);
    const merged = [...byId.values()];
    if (merged.length > MAX_PENDING_CONVERSATION_TAIL_CHUNKS) {
      throw new Error(
        `Cloud conversation tail outbox is full (${merged.length}/${MAX_PENDING_CONVERSATION_TAIL_CHUNKS} chunks)`
      );
    }
    await saveRows(store, merged);
  });
  return chunks.map((chunk) => chunk.id);
}

/**
 * Drain only the signed-in account's rows. Network I/O happens outside the
 * store lock so an offline request cannot block a new provider turn from
 * durably staging its tail. Duplicate concurrent pushes are harmless because
 * Cloud event ids are idempotent.
 */
export async function drainConversationTailOutbox(params: {
  authIdentityKey: string;
  getAccessToken: () => Promise<string>;
  onPushed?: (orgId: string) => void;
}): Promise<ConversationTailDrainResult> {
  const store = await durableStore();
  const pushedChunks: ConversationTailDrainResult["pushedChunks"] = [];
  const attempted = new Set<string>();
  for (;;) {
    const snapshot = await withOutboxLock(async () =>
      (await loadRows(store))
        .filter(
          (candidate) =>
            candidate.authIdentityKey === params.authIdentityKey &&
            !candidate.failedError &&
            !attempted.has(candidate.id)
        )
        .slice(0, MAX_DRAIN_CHUNKS_PER_PASS)
    );
    if (snapshot.length === 0) break;

    const successful: PendingConversationTailChunk[] = [];
    const terminalFailures = new Map<
      string,
      { row: PendingConversationTailChunk; failedError: string }
    >();
    let transportError: unknown = null;
    const accessToken = await params.getAccessToken();
    for (const row of snapshot) {
      attempted.add(row.id);
      try {
        await pushConversationEvents(accessToken, {
          orgId: row.orgId,
          rootSessionId: row.rootSessionId,
          turnId: row.turnId,
          events: row.events,
        });
        successful.push(row);
      } catch (error) {
        const rowTerminal =
          error instanceof Org2CloudConversationError &&
          (error.code === "ORG2_VALIDATION" ||
            error.code === "ORG2_ORG_NOT_FOUND" ||
            error.code === "ORG2_FORBIDDEN" ||
            error.code === "ORG2_MEMBER_REQUIRED" ||
            error.code === "ORG2_CONVERSATION_BATCH_TOO_LARGE" ||
            error.code === "ORG2_CONVERSATION_EVENT_TOO_LARGE");
        if (!rowTerminal) {
          transportError = error;
          break;
        }
        const failedError =
          error instanceof Error ? error.message : "Cloud publication failed";
        terminalFailures.set(row.id, { row, failedError });
        log.error(
          `conversation tail ${row.id} requires manual recovery`,
          error
        );
      }
    }

    // One CAS-style commit per bounded network pass. A concurrent restage of
    // the same id is a new revision and must never be removed or marked failed
    // by this older attempt.
    await withOutboxLock(async () => {
      const current = await loadRows(store);
      const successfulById = new Map(
        successful.map((row) => [row.id, row] as const)
      );
      const next = current.flatMap((candidate) => {
        const pushed = successfulById.get(candidate.id);
        if (pushed && isSameStagedRevision(candidate, pushed)) return [];
        const failed = terminalFailures.get(candidate.id);
        if (failed && isSameStagedRevision(candidate, failed.row)) {
          return [{ ...candidate, failedError: failed.failedError }];
        }
        return [candidate];
      });
      await saveRows(store, next);
    });
    for (const row of successful) {
      pushedChunks.push({ id: row.id, eventCount: row.events.length });
      params.onPushed?.(row.orgId);
    }
    if (transportError) throw transportError;
  }
  const remaining = await withOutboxLock(async () =>
    (await loadRows(store)).filter(
      (row) => row.authIdentityKey === params.authIdentityKey
    )
  );
  const pushed = pushedChunks.reduce(
    (total, chunk) => total + chunk.eventCount,
    0
  );
  if (pushed > 0) {
    log.info(`published ${pushed} durable conversation tail event(s)`);
  }
  return {
    pushedChunks,
    failedChunkIds: remaining
      .filter((row) => Boolean(row.failedError))
      .map((row) => row.id),
    pendingChunkIds: remaining
      .filter((row) => !row.failedError)
      .map((row) => row.id),
  };
}
