/**
 * Client store for the 0024 conversation-events plane: per-conversation
 * incremental fetch keyed by `(authIdentity, orgId, rootSessionId)` with a
 * dense server-assigned seq cursor. `authIdentity` includes the Cloud endpoint
 * and account, so two accounts that can name the same org/session never share
 * cached events or a single-flight request. Capability-gated — a pre-0024
 * backend leaves every entry "unsupported" and the fork-wire fallback stays
 * in charge.
 */
import {
  atom,
  type createStore,
  useAtomValue,
  useSetAtom,
  useStore,
} from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { useCallback } from "react";

import { createLogger } from "@src/hooks/logger";
import { BoundedMap } from "@src/util/collections/BoundedMap";

import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "../org2CloudAuthAtom";
import type { Org2CloudAuthState } from "../org2CloudAuthAtom";
import { getCloudCapabilitiesConfirmed } from "../org2CloudCapabilities";
import { ensureFreshSession } from "../org2CloudClient";
import {
  type CloudConversationEvent,
  decodeConversationEventChunks,
  listConversationEvents,
} from "../org2CloudConversationEventsClient";
import { REALTIME_SIGNAL_COALESCE_MS } from "../org2CloudRealtimeSignalCoalescer";
import type { SessionCommentTarget } from "../sessionCommentTarget";
import { drainConversationTailOutbox } from "./conversationTailOutbox";

const log = createLogger("ConversationPlane");
const MAX_CONVERSATION_PLANE_ENTRIES = 64;
const MAX_CONVERSATION_PLANE_SIGNALS = 64;

export type ConversationPlaneState =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";

export interface ConversationPlaneEntry {
  /** Endpoint + account privacy/cache boundary for this snapshot. */
  authIdentityKey: string;
  orgId: string;
  rootSessionId: string;
  state: ConversationPlaneState;
  /** Ordered by seq asc; deduped by wire id. */
  events: CloudConversationEvent[];
  lastSeq: number;
}

export interface ConversationPlaneLocator {
  authIdentityKey: string;
  orgId: string;
  rootSessionId: string;
}

const KEY_SEPARATOR = "\u001f";

function emptyEntry(locator: ConversationPlaneLocator): ConversationPlaneEntry {
  return {
    ...locator,
    state: "idle",
    events: [],
    lastSeq: 0,
  };
}

export function conversationPlaneKey(
  locator: ConversationPlaneLocator
): string {
  return [locator.authIdentityKey, locator.orgId, locator.rootSessionId].join(
    KEY_SEPARATOR
  );
}

export const conversationPlaneAtom = atom<
  Record<string, ConversationPlaneEntry>
>({});

/** orgId → monotonically increasing signal counter (realtime bump). */
export const conversationPlaneSignalAtom = atom<Record<string, number>>({});

type ConversationPlaneEntries = Record<string, ConversationPlaneEntry>;
type JotaiStore = ReturnType<typeof createStore>;
type SetConversationPlaneEntries = (
  update: (current: ConversationPlaneEntries) => ConversationPlaneEntries
) => void;
type SetCloudAuth = (
  update: (current: Org2CloudAuthState | null) => Org2CloudAuthState | null
) => void;

interface RefreshConversationPlaneParams {
  store: JotaiStore;
  auth: Org2CloudAuthState;
  orgId: string;
  rootSessionId: string;
  getEntry: () => ConversationPlaneEntry | undefined;
  setEntries: SetConversationPlaneEntries;
  setAuth: SetCloudAuth;
}

interface ConversationPlaneRequestState {
  activeIdentityKey: string | null;
  epoch: number;
  inFlightByKey: Map<string, Promise<ConversationPlaneEntry>>;
}

const requestStateByStore = new WeakMap<
  JotaiStore,
  ConversationPlaneRequestState
>();

function requestStateFor(store: JotaiStore): ConversationPlaneRequestState {
  let state = requestStateByStore.get(store);
  if (!state) {
    state = {
      activeIdentityKey: null,
      epoch: 0,
      inFlightByKey: new Map(),
    };
    requestStateByStore.set(store, state);
  }
  return state;
}

function boundedRecordWrite<T>(
  current: Record<string, T>,
  key: string,
  value: T,
  maxSize: number
): Record<string, T> {
  const bounded = new BoundedMap<string, T>({ maxSize });
  for (const [existingKey, existingValue] of Object.entries(current)) {
    bounded.set(existingKey, existingValue);
  }
  bounded.set(key, value);
  return Object.fromEntries(bounded.entries());
}

function writeConversationPlaneEntry(
  current: ConversationPlaneEntries,
  key: string,
  entry: ConversationPlaneEntry
): ConversationPlaneEntries {
  return boundedRecordWrite(
    current,
    key,
    entry,
    MAX_CONVERSATION_PLANE_ENTRIES
  );
}

function activateConversationPlaneIdentity(
  store: JotaiStore,
  authIdentityKey: string | null,
  setEntries: SetConversationPlaneEntries
): ConversationPlaneRequestState {
  const state = requestStateFor(store);
  if (state.activeIdentityKey === authIdentityKey) return state;
  state.activeIdentityKey = authIdentityKey;
  state.epoch += 1;
  state.inFlightByKey.clear();
  setEntries((current) => {
    const retained = Object.fromEntries(
      Object.entries(current).filter(
        ([, entry]) => entry.authIdentityKey === authIdentityKey
      )
    );
    return Object.keys(retained).length === Object.keys(current).length
      ? current
      : retained;
  });
  return state;
}

function storeHasConversationPlaneIdentity(
  store: JotaiStore,
  authIdentityKey: string
): boolean {
  const current = store.get(org2CloudAuthAtom);
  return Boolean(
    current && org2CloudAuthIdentityKey(current) === authIdentityKey
  );
}

function locatorForRequest(
  params: Pick<
    RefreshConversationPlaneParams,
    "auth" | "orgId" | "rootSessionId"
  >
): ConversationPlaneLocator {
  return {
    authIdentityKey: org2CloudAuthIdentityKey(params.auth),
    orgId: params.orgId,
    rootSessionId: params.rootSessionId,
  };
}

function entryMatchesLocator(
  entry: ConversationPlaneEntry | undefined,
  locator: ConversationPlaneLocator
): entry is ConversationPlaneEntry {
  return (
    entry?.authIdentityKey === locator.authIdentityKey &&
    entry.orgId === locator.orgId &&
    entry.rootSessionId === locator.rootSessionId
  );
}

function mergePlaneEvents(
  previous: ConversationPlaneEntry,
  incoming: readonly CloudConversationEvent[]
): ConversationPlaneEntry {
  if (incoming.length === 0) {
    return { ...previous, state: "ready" };
  }
  const known = new Set(previous.events.map((event) => event.id));
  const fresh = incoming.filter((event) => !known.has(event.id));
  const events = [...previous.events, ...fresh].sort(
    (left, right) => left.seq - right.seq
  );
  return {
    ...previous,
    state: "ready",
    events,
    lastSeq: events.length > 0 ? events[events.length - 1].seq : 0,
  };
}

/**
 * One authoritative loader shared by the mounted transcript and the submit
 * boundary. A capable backend must never race through the legacy visible-fork
 * path merely because its first plane fetch is still in flight.
 */
export function refreshConversationPlaneEntry(
  params: RefreshConversationPlaneParams
): Promise<ConversationPlaneEntry> {
  const locator = locatorForRequest(params);
  if (
    !storeHasConversationPlaneIdentity(params.store, locator.authIdentityKey)
  ) {
    return Promise.reject(
      new Error("cloud auth identity changed before plane refresh")
    );
  }
  const key = conversationPlaneKey(locator);
  const requestState = activateConversationPlaneIdentity(
    params.store,
    locator.authIdentityKey,
    params.setEntries
  );
  const requestEpoch = requestState.epoch;
  const isCurrentRequest = () =>
    requestState.activeIdentityKey === locator.authIdentityKey &&
    requestState.epoch === requestEpoch;
  const existing = requestState.inFlightByKey.get(key);
  if (existing) return existing;

  const load = (async (): Promise<ConversationPlaneEntry> => {
    const storedBefore = params.getEntry();
    const before = entryMatchesLocator(storedBefore, locator)
      ? storedBefore
      : emptyEntry(locator);
    if (before.state !== "ready") {
      params.setEntries((current) =>
        isCurrentRequest()
          ? writeConversationPlaneEntry(current, key, {
              ...before,
              state: "loading",
            })
          : current
      );
    }
    try {
      const fresh = await ensureFreshSession(params.auth);
      if (!fresh) throw new Error("cloud auth refresh failed");
      if (
        !isCurrentRequest() ||
        org2CloudAuthIdentityKey(fresh) !== locator.authIdentityKey
      ) {
        throw new Error("cloud auth identity changed during plane refresh");
      }
      commitRefreshedAuth(params.setAuth, params.auth, fresh);
      const probe = await getCloudCapabilitiesConfirmed(fresh.accessToken);
      if (!probe.capabilities.conversationEvents) {
        if (!probe.confirmed) {
          throw new Error(
            "conversation plane capability probe was unconfirmed"
          );
        }
        const unsupported = {
          ...emptyEntry(locator),
          state: "unsupported",
        } as const;
        params.setEntries((current) =>
          isCurrentRequest()
            ? writeConversationPlaneEntry(current, key, unsupported)
            : current
        );
        return unsupported;
      }

      const stored = params.getEntry();
      let resolved = entryMatchesLocator(stored, locator) ? stored : before;
      let afterSeq = resolved.lastSeq;
      for (;;) {
        const page = await listConversationEvents(fresh.accessToken, {
          orgId: params.orgId,
          rootSessionId: params.rootSessionId,
          afterSeq,
        });
        if (!isCurrentRequest()) {
          throw new Error("cloud auth identity changed during plane refresh");
        }
        params.setEntries((current) => {
          if (!isCurrentRequest()) return current;
          const storedCurrent = current[key];
          const previous = entryMatchesLocator(storedCurrent, locator)
            ? storedCurrent
            : emptyEntry(locator);
          resolved = mergePlaneEvents(previous, page.events);
          return writeConversationPlaneEntry(current, key, resolved);
        });
        if (!page.hasMore || page.events.length === 0) break;
        afterSeq = page.events[page.events.length - 1].seq;
      }
      const wireLastSeq = resolved.lastSeq;
      const decodedEvents = await decodeConversationEventChunks(
        resolved.events
      );
      resolved = {
        ...resolved,
        events: decodedEvents,
        // Chunk envelopes collapse to one logical event whose row carries the
        // last chunk seq. Preserve the raw cursor even when no logical event
        // was added by this refresh.
        lastSeq: wireLastSeq,
      };
      params.setEntries((current) =>
        isCurrentRequest()
          ? writeConversationPlaneEntry(current, key, resolved)
          : current
      );
      return resolved;
    } catch (error) {
      params.setEntries((current) => {
        if (!isCurrentRequest()) return current;
        const storedCurrent = current[key];
        const previous = entryMatchesLocator(storedCurrent, locator)
          ? storedCurrent
          : emptyEntry(locator);
        if (previous.state === "ready") return current;
        return writeConversationPlaneEntry(current, key, {
          ...previous,
          state: "error",
        });
      });
      throw error;
    }
  })();
  requestState.inFlightByKey.set(key, load);
  const clearInFlight = () => {
    if (requestState.inFlightByKey.get(key) === load) {
      requestState.inFlightByKey.delete(key);
    }
  };
  void load.then(clearInFlight, clearInFlight);
  return load;
}

/**
 * Keeps the plane entry for the given conversation target fetched and
 * incrementally fresh. Refetches whenever the org's signal counter bumps
 * (realtime `conversationEvents` kind) and after local pushes (the pusher
 * bumps the same signal).
 */
export function useConversationPlaneEvents(
  target: SessionCommentTarget | null
): ConversationPlaneEntry {
  const auth = useAtomValue(org2CloudAuthAtom);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const store = useStore();
  const setAuth = useSetAtom(org2CloudAuthAtom);
  const entries = useAtomValue(conversationPlaneAtom);
  const setEntries = useSetAtom(conversationPlaneAtom);
  const signals = useAtomValue(conversationPlaneSignalAtom);
  const setSignals = useSetAtom(conversationPlaneSignalAtom);
  const lastForegroundRecoverAtRef = useRef(0);
  const targetOrgId = target?.orgId;
  const targetSessionId = target?.sessionId;
  const signal = targetOrgId ? (signals[targetOrgId] ?? 0) : 0;
  const locator = useMemo(
    () =>
      authIdentityKey && targetOrgId && targetSessionId
        ? {
            authIdentityKey,
            orgId: targetOrgId,
            rootSessionId: targetSessionId,
          }
        : null,
    [authIdentityKey, targetOrgId, targetSessionId]
  );
  const key = locator ? conversationPlaneKey(locator) : null;
  const entry = locator
    ? entryMatchesLocator(entries[key!], locator)
      ? entries[key!]
      : emptyEntry(locator)
    : emptyEntry({ authIdentityKey: "", orgId: "", rootSessionId: "" });

  const drainTailOutbox = useCallback(async () => {
    if (!auth || !authIdentityKey) return;
    await drainConversationTailOutbox({
      authIdentityKey,
      getAccessToken: async () => {
        const fresh = await ensureFreshSession(auth);
        if (!fresh) throw new Error("cloud auth refresh failed");
        commitRefreshedAuth(setAuth, auth, fresh);
        return fresh.accessToken;
      },
      onPushed: (orgId) => bumpConversationPlaneSignal(setSignals, orgId),
    });
  }, [auth, authIdentityKey, setAuth, setSignals]);

  useEffect(() => {
    const previousIdentity = requestStateFor(store).activeIdentityKey;
    activateConversationPlaneIdentity(store, authIdentityKey, setEntries);
    if (previousIdentity !== authIdentityKey) setSignals({});
  }, [authIdentityKey, setEntries, setSignals, store]);

  useEffect(() => {
    if (!targetOrgId || !targetSessionId || !key || !auth || !locator) return;
    const storedCurrent = store.get(conversationPlaneAtom)[key];
    const currentEntry = entryMatchesLocator(storedCurrent, locator)
      ? storedCurrent
      : emptyEntry(locator);
    if (currentEntry.state === "unsupported") return;
    void (async () => {
      await drainTailOutbox().catch((error: unknown) => {
        log.warn("conversation tail outbox recovery failed", error);
      });
      await refreshConversationPlaneEntry({
        store,
        auth,
        orgId: targetOrgId,
        rootSessionId: targetSessionId,
        getEntry: () => store.get(conversationPlaneAtom)[key],
        setEntries,
        setAuth,
      });
    })().catch((error: unknown) => {
      log.warn(`conversation plane fetch failed for ${key}`, error);
    });
  }, [
    targetOrgId,
    targetSessionId,
    key,
    locator,
    auth,
    setAuth,
    setEntries,
    signal,
    store,
    drainTailOutbox,
  ]);

  // A short foreground switch does not release the shared Realtime socket
  // (the lease intentionally has a blur grace), so it cannot rely on a new
  // SUBSCRIBED edge to recover an at-most-once broadcast. Match the other
  // Cloud planes: on actual foreground regain, run one cooldown-bounded
  // incremental pull from this conversation's durable seq cursor.
  useEffect(() => {
    if (
      !targetOrgId ||
      !targetSessionId ||
      !key ||
      !locator ||
      !auth ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return undefined;
    }
    const recover = () => {
      if (document.visibilityState === "hidden") return;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) {
        return;
      }
      if (
        Date.now() - lastForegroundRecoverAtRef.current <
        REALTIME_SIGNAL_COALESCE_MS
      ) {
        return;
      }
      // A native foreground transition can emit both `focus` and
      // `visibilitychange`; collapse only that duplicate pair. Unlike the
      // 30-second full-list cooldown used by heavier Cloud planes, each
      // distinct app switch must advance this cheap `after_seq` cursor.
      lastForegroundRecoverAtRef.current = Date.now();
      void (async () => {
        await drainTailOutbox();
        await refreshConversationPlaneEntry({
          store,
          auth,
          orgId: targetOrgId,
          rootSessionId: targetSessionId,
          getEntry: () => store.get(conversationPlaneAtom)[key],
          setEntries,
          setAuth,
        });
      })().catch((error: unknown) => {
        log.warn(
          `conversation plane foreground recovery failed for ${key}`,
          error
        );
      });
    };
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [
    targetOrgId,
    targetSessionId,
    key,
    locator,
    auth,
    setAuth,
    setEntries,
    store,
    drainTailOutbox,
  ]);

  return entry;
}

/** Bump helper for realtime dispatch and local pushes. */
export function bumpConversationPlaneSignal(
  set: (
    update: (current: Record<string, number>) => Record<string, number>
  ) => void,
  orgId: string
): void {
  set((current) =>
    boundedRecordWrite(
      current,
      orgId,
      (current[orgId] ?? 0) + 1,
      MAX_CONVERSATION_PLANE_SIGNALS
    )
  );
}
