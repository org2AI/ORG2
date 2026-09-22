import { getExternalHistorySourceId } from "@src/util/session/sessionDispatch";

import type { MobileRpcClient } from "./mobileRpcClient";
import type { MobileSessionRow } from "./types";

export interface MobileSessionIdentity {
  sessionId: string;
  managed: boolean;
}

const MAX_IDENTITIES = 32;
const MAX_PENDING_IDENTITIES = 8;
const MAX_PREFETCH_IDENTITIES = 8;
const PREFETCH_CONCURRENCY = 2;
const IDENTITY_TTL_MS = 5 * 60_000;
// At most two full batches per fixed transport timeout window, even when list
// invalidations abandon requests whose wire replies have not arrived yet.
const PREFETCH_WINDOW_MS = 15_000;
const PREFETCH_WINDOW_LIMIT = 16;

type PrefetchRequest = {
  ids: string[];
  shouldContinue: () => boolean;
};
type PrefetchState = {
  queued?: PrefetchRequest;
  running?: Promise<void>;
  windowStart: number;
  remaining: number;
};

type Cache = {
  generation: number;
  listeners: Set<() => void>;
  resolved: Map<string, { value: MobileSessionIdentity; expiresAt: number }>;
  pending: Map<
    string,
    { promise: Promise<MobileSessionIdentity>; abort: AbortController }
  >;
};

// The authenticated RPC client is the lifetime and isolation boundary: no disk
// persistence, no session-id-only global cache, and no new network listeners.
const caches = new WeakMap<MobileRpcClient, Cache>();
const prefetchStates = new WeakMap<MobileRpcClient, PrefetchState>();

/** Matches the Desktop session_identity adapter: only Codex App mirrors remap. */
export function needsMobileSessionIdentityResolution(
  sessionId: string
): boolean {
  return getExternalHistorySourceId(sessionId) === "codex_app";
}

export class MobileSessionIdentityInvalidated extends Error {
  constructor() {
    super("Session identity was invalidated");
  }
}

function identityCache(client: MobileRpcClient): Cache {
  let cache = caches.get(client);
  if (!cache) {
    cache = {
      generation: 0,
      listeners: new Set(),
      resolved: new Map(),
      pending: new Map(),
    };
    caches.set(client, cache);
  }
  return cache;
}

/** Changes only on authoritative invalidation, not on ordinary renders or reads. */
export function mobileSessionIdentityGeneration(
  client: MobileRpcClient
): number {
  return caches.get(client)?.generation ?? 0;
}

export function subscribeMobileSessionIdentities(
  client: MobileRpcClient,
  listener: () => void
) {
  const cache = identityCache(client);
  cache.listeners.add(listener);
  return () => {
    cache.listeners.delete(listener);
  };
}

export function cachedMobileSessionIdentity(
  client: MobileRpcClient,
  requested: string
): MobileSessionIdentity | undefined {
  const entry = caches.get(client)?.resolved.get(requested);
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

export function invalidateMobileSessionIdentities(client: MobileRpcClient) {
  const cache = caches.get(client);
  if (!cache) return;
  cache.generation += 1;
  cache.resolved.clear();
  const abandoned = Array.from(cache.pending.values());
  cache.pending.clear();
  for (const flight of abandoned) flight.abort.abort();
  for (const listener of cache.listeners) listener();
}

export function resolveMobileSessionIdentity(
  client: MobileRpcClient,
  requested: string
): Promise<MobileSessionIdentity> {
  const cache = identityCache(client);
  const hit = cachedMobileSessionIdentity(client, requested);
  if (hit) return Promise.resolve(hit);
  const pending = cache.pending.get(requested);
  if (pending) return pending.promise;
  if (cache.pending.size >= MAX_PENDING_IDENTITIES) {
    return Promise.reject(
      new Error("Too many pending session identity lookups")
    );
  }
  const owner = cache;
  const generation = owner.generation;
  const abort = new AbortController();
  // Keep a shared request alive across route unmount/remount. Its lifetime is
  // bounded by the RPC timeout and cancelled by connection/list invalidation.
  const promise = Promise.resolve().then(async () => {
    try {
      if (generation !== owner.generation)
        throw new MobileSessionIdentityInvalidated();
      const result = await client.call<{
        sessionId?: unknown;
        managed?: unknown;
      }>("session/resolve", { sessionId: requested }, abort.signal);
      if (generation !== owner.generation)
        throw new MobileSessionIdentityInvalidated();
      if (
        typeof result?.sessionId !== "string" ||
        !result.sessionId.trim() ||
        result.sessionId.length > 256 ||
        typeof result.managed !== "boolean"
      )
        throw new Error("Invalid session identity");
      const value = { sessionId: result.sessionId, managed: result.managed };
      for (const [key, entry] of owner.resolved) {
        if (entry.expiresAt <= Date.now()) owner.resolved.delete(key);
      }
      owner.resolved.delete(requested);
      owner.resolved.set(requested, {
        value,
        expiresAt: Date.now() + IDENTITY_TTL_MS,
      });
      while (owner.resolved.size > MAX_IDENTITIES) {
        owner.resolved.delete(owner.resolved.keys().next().value!);
      }
      return value;
    } catch (error) {
      if (generation !== owner.generation)
        throw new MobileSessionIdentityInvalidated();
      throw error;
    } finally {
      if (owner.pending.get(requested)?.promise === promise)
        owner.pending.delete(requested);
    }
  });
  owner.pending.set(requested, { promise, abort });
  return promise;
}

/**
 * Warm identities after discovery/refresh without holding roster publication.
 * One coordinator per authenticated client coalesces snapshots to the latest
 * batch. Invalidations may rewarm; hits cost no RPC. Work stays bounded without
 * polling or idle timers. A miss/failure remains safely retryable on opening.
 */
export async function prefetchMobileSessionIdentities(
  client: MobileRpcClient,
  sessions: readonly MobileSessionRow[],
  shouldContinue: () => boolean = () => true
): Promise<void> {
  const ids = Array.from(
    new Set(
      sessions
        .filter((session) => needsMobileSessionIdentityResolution(session.id))
        .map((session) => session.id)
    )
  ).slice(0, MAX_PREFETCH_IDENTITIES);
  if (!shouldContinue()) return;
  let state = prefetchStates.get(client);
  if (!state) {
    state = { windowStart: Date.now(), remaining: PREFETCH_WINDOW_LIMIT };
    prefetchStates.set(client, state);
  }
  const owner = state;
  owner.queued = { ids, shouldContinue };
  if (owner.running) return owner.running;
  const drain = async () => {
    try {
      while (owner.queued) {
        const batch = owner.queued;
        owner.queued = undefined;
        let cursor = 0;
        const worker = async () => {
          while (cursor < batch.ids.length) {
            // A newer roster supersedes queued rows, while in-flight RPCs remain
            // shared with a user who opens the row during preparation.
            if (owner.queued || !batch.shouldContinue()) return;
            const id = batch.ids[cursor++];
            if (cachedMobileSessionIdentity(client, id)) continue;
            if (Date.now() - owner.windowStart >= PREFETCH_WINDOW_MS) {
              owner.windowStart = Date.now();
              owner.remaining = PREFETCH_WINDOW_LIMIT;
            }
            if (owner.remaining === 0) return;
            owner.remaining -= 1;
            try {
              await resolveMobileSessionIdentity(client, id);
            } catch {
              // No automatic retry loop. The next roster or explicit open can
              // retry, subject to the shared budget and normal RPC timeout.
            }
          }
        };
        await Promise.allSettled(
          Array.from(
            { length: Math.min(PREFETCH_CONCURRENCY, batch.ids.length) },
            worker
          )
        );
      }
    } finally {
      owner.running = undefined;
    }
  };
  // Install the flight before workers start so synchronous roster callers share it.
  owner.running = Promise.resolve().then(drain);
  return owner.running;
}
