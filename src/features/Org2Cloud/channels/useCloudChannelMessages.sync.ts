/**
 * Page/delta reconciliation for `useCloudChannelMessages`: the initial
 * DESCENDING keyset page (re-run on a refresh nonce or a capped delta) and
 * the `p_since` delta a realtime `channelMessages` bump triggers. Both read
 * the hook's state through stable setters and refs so the effect triggers
 * stay exactly the values listed in their dependency arrays.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";

import { getCloudCapabilities } from "@src/features/Org2Cloud/org2CloudCapabilities";
import { endpointForOrg } from "@src/features/Org2Cloud/org2CloudOrgEndpointRouter";
import { createLogger } from "@src/hooks/logger";

import { listCloudChannelMessages } from "./channelMessagesClient";
import type { CloudChannelMessage } from "./channelMessagesTypes";
import { CHANNEL_MESSAGES_PAGE_SIZE } from "./channelMessagesTypes";
import {
  hasOrgChannelMessagesCapability,
  hasOrgChannelMessagesIdempotencyCapability,
  mergeChannelMessageDelta,
  sortChannelMessages,
} from "./useCloudChannelMessages.transforms";

const log = createLogger("CloudChannelMessages");

export interface CloudChannelMessagesSyncRefs {
  requestRef: MutableRefObject<number>;
  versionRef: MutableRefObject<number>;
  idempotencyRef: MutableRefObject<boolean>;
  serverTimeRef: MutableRefObject<string | null>;
  handledVersionRef: MutableRefObject<number>;
  listKeyRef: MutableRefObject<string | null>;
  nextCursorRef: MutableRefObject<string | null>;
}

export interface CloudChannelMessagesSyncSetters {
  setSupported: Dispatch<SetStateAction<boolean | null>>;
  setMessages: Dispatch<SetStateAction<CloudChannelMessage[] | null>>;
  setMessagesKey: Dispatch<SetStateAction<string | null>>;
  setNextCursor: Dispatch<SetStateAction<string | null>>;
  setUnreadCount: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setFetching: Dispatch<SetStateAction<boolean>>;
  setRefreshNonce: Dispatch<SetStateAction<number>>;
}

export function useCloudChannelMessagesSync(input: {
  authIdentityKey: string | null;
  orgId: string | null;
  channelId: string | null;
  listKey: string | null;
  messagesKey: string | null;
  version: number;
  refreshNonce: number;
  fetching: boolean;
  getFreshAccessToken: () => Promise<string>;
  refs: CloudChannelMessagesSyncRefs;
  setters: CloudChannelMessagesSyncSetters;
}): void {
  const {
    authIdentityKey,
    orgId,
    channelId,
    listKey,
    messagesKey,
    version,
    refreshNonce,
    fetching,
    getFreshAccessToken,
  } = input;
  const {
    requestRef,
    versionRef,
    idempotencyRef,
    serverTimeRef,
    handledVersionRef,
    listKeyRef,
    nextCursorRef,
  } = input.refs;
  const {
    setSupported,
    setMessages,
    setMessagesKey,
    setNextCursor,
    setUnreadCount,
    setError,
    setFetching,
    setRefreshNonce,
  } = input.setters;

  // --- Initial page (and full reloads: refresh nonce / capped delta).
  useEffect(() => {
    if (!authIdentityKey || !orgId || !channelId) return;
    let cancelled = false;
    const seq = ++requestRef.current;
    // Stamp the version observed at START: a bump that lands while the page
    // request is in flight names a write the page snapshot may predate, and
    // stamping the completion-time version would swallow it.
    const versionAtStart = versionRef.current;
    (async () => {
      setFetching(true);
      setError(null);
      try {
        const accessToken = await getFreshAccessToken();
        // Per-endpoint probe: a home-endpoint org answers for its OWN backend,
        // so the message gate is read off the server that would serve it.
        const capabilities = await getCloudCapabilities(
          accessToken,
          endpointForOrg(orgId)
        );
        const isSupported = hasOrgChannelMessagesCapability(capabilities);
        if (cancelled || seq !== requestRef.current) return;
        idempotencyRef.current =
          hasOrgChannelMessagesIdempotencyCapability(capabilities);
        setSupported(isSupported);
        if (!isSupported) return;
        const page = await listCloudChannelMessages(
          accessToken,
          orgId,
          channelId,
          { limit: CHANNEL_MESSAGES_PAGE_SIZE }
        );
        if (cancelled || seq !== requestRef.current) return;
        // Page mode is DESCENDING keyset; the transcript renders ascending.
        setMessages(sortChannelMessages(page.messages));
        setMessagesKey(`${authIdentityKey}|${orgId}|${channelId}`);
        // Page mode signals "older rows exist" via nextCursor itself; the
        // hasMore field only exists in delta mode (schema defaults it false
        // here), so gating on it silently disabled pagination end to end.
        setNextCursor(page.nextCursor ?? null);
        setUnreadCount(page.unreadCount);
        serverTimeRef.current = page.serverTime ?? null;
        handledVersionRef.current = versionAtStart;
      } catch (err) {
        log.warn("cloud channel messages fetch failed:", err);
        if (!cancelled && seq === requestRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled && seq === requestRef.current) setFetching(false);
      }
    })().catch((err) => {
      log.warn("cloud channel messages fetch failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [
    authIdentityKey,
    orgId,
    channelId,
    refreshNonce,
    getFreshAccessToken,
    requestRef,
    versionRef,
    idempotencyRef,
    serverTimeRef,
    handledVersionRef,
    setSupported,
    setMessages,
    setMessagesKey,
    setNextCursor,
    setUnreadCount,
    setError,
    setFetching,
  ]);

  // --- Delta reconciliation on a realtime `channelMessages` bump.
  useEffect(() => {
    if (!orgId || !channelId || !listKey) return;
    if (messagesKey !== listKey) {
      // Nothing loaded for THIS scope. A version bump arriving here names a
      // failed (or transiently mis-probed) page load: without a retry the
      // panel would sit in its error/gated state until the tab is closed —
      // no signal, focus edge, or reconnect would ever recover it. Bump the
      // nonce so the FULL page effect (probe included) re-runs; retries stay
      // strictly event-driven.
      if (version !== handledVersionRef.current) {
        handledVersionRef.current = version;
        if (!fetching) setRefreshNonce((nonce) => nonce + 1);
      }
      return;
    }
    if (version === handledVersionRef.current) return;
    handledVersionRef.current = version;
    let cancelled = false;
    const keyAtStart = listKey;
    const seqAtStart = requestRef.current;
    (async () => {
      const since = serverTimeRef.current;
      if (!since) {
        // No cursor to delta from (older backend omitted `serverTime`):
        // a full page reload is the only correct convergence.
        setRefreshNonce((nonce) => nonce + 1);
        return;
      }
      try {
        const accessToken = await getFreshAccessToken();
        const delta = await listCloudChannelMessages(
          accessToken,
          orgId,
          channelId,
          { since }
        );
        if (
          cancelled ||
          listKeyRef.current !== keyAtStart ||
          seqAtStart !== requestRef.current
        ) {
          return;
        }
        if (delta.hasMore) {
          // The delta hit the server cap: merging it would advance the cursor
          // past rows this client never saw. Reload the page instead.
          setRefreshNonce((nonce) => nonce + 1);
          return;
        }
        setMessages((current) =>
          current
            ? mergeChannelMessageDelta(current, delta.messages, {
                windowFloor: nextCursorRef.current
                  ? current[0]?.createdAt
                  : null,
              })
            : current
        );
        setUnreadCount(delta.unreadCount);
        serverTimeRef.current = delta.serverTime ?? since;
      } catch (err) {
        // A failed delta is not a broken transcript: keep the rows on screen
        // and let the next signal (or the reconnect edge) converge.
        log.warn("cloud channel messages delta failed:", err);
      }
    })().catch((err) => {
      log.warn("cloud channel messages delta failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [
    version,
    listKey,
    messagesKey,
    orgId,
    channelId,
    fetching,
    getFreshAccessToken,
    requestRef,
    serverTimeRef,
    handledVersionRef,
    listKeyRef,
    nextCursorRef,
    setMessages,
    setUnreadCount,
    setRefreshNonce,
  ]);
}
