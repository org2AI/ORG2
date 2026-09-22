/**
 * Data hook for ONE cloud channel's message transcript.
 *
 * Same shape as its control-plane sibling `useOrgChannels`: the slice-wide
 * `useFreshChannelAccessToken` for tokens, a per-endpoint capability probe
 * (`orgChannelMessages`) that resolves "unsupported" instead of calling a
 * missing RPC, identity-keyed state wiped on account switch, and a monotonic
 * request counter dropping late completions after a channel/org switch.
 *
 * What this hook adds over the list hook is a real reconciliation loop:
 *
 *  - **initial page** — DESCENDING keyset page, reversed for display.
 *  - **loadOlder** — the previous page's `nextCursor`, merged by id.
 *  - **delta** — a realtime `channelMessages` bump re-reads with `p_since =
 *    <last serverTime>`. That delta carries EDITS and TOMBSTONES too, so
 *    merging by id converges a body edit and a delete on rows already on
 *    screen without re-listing. A capped delta (`hasMore`) is not merged —
 *    advancing the cursor past unseen rows would lose them — it forces a full
 *    page reload instead.
 *  - **optimistic post** — the row lands immediately and is rolled back if
 *    the RPC refuses; `postMessage` RETHROWS so the composer's
 *    `onSubmitOverride` can restore the editor snapshot (see
 *    `channelPostHandler.ts`) rather than eating the user's draft.
 *  - **read cursor** — debounced `cloud_set_channel_read_cursor` once the
 *    newest row is on screen (the transcript rests scrolled to the bottom, so
 *    "newest row rendered while the document is visible" IS the visible case).
 *  - **focus catch-up** — the focus-regain edge bumps this channel's version,
 *    so a window that missed the realtime signal while backgrounded converges
 *    through the delta path above (`useOrgChannels` idiom, with cleanup).
 *
 * Strictly event-driven; no polling.
 *
 * The pure transforms live in `useCloudChannelMessages.transforms.ts`;
 * the page/delta reconciliation, post/edit/delete, `loadOlder`, and the
 * read cursor each live in a sibling `useCloudChannelMessages.*` hook.
 * This file owns the identity-keyed state and the composed result.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { onWindowFocusRegained } from "@src/util/core/windowFocus";

import type { CloudChannelMessage } from "./channelMessagesTypes";
import {
  bumpOrg2CloudChannelMessagesVersionAtom,
  org2CloudChannelMessagesVersionAtom,
  selectChannelMessagesVersion,
} from "./channelsAtom";
import { useFreshChannelAccessToken } from "./components/useChannelDialogAccess";
import { useCloudChannelLoadOlder } from "./useCloudChannelMessages.loadOlder";
import { useCloudChannelMessageMutations } from "./useCloudChannelMessages.mutations";
import { useCloudChannelReadCursor } from "./useCloudChannelMessages.readCursor";
import { useCloudChannelMessagesSync } from "./useCloudChannelMessages.sync";
import {
  CHANNEL_READ_CURSOR_DEBOUNCE_MS,
  type CloudChannelMessagesOptions,
  type CloudChannelMessagesPhase,
  type CloudChannelMessagesState,
} from "./useCloudChannelMessages.transforms";

// Re-exports: preserve this module's public import path for the constants,
// types and pure helpers that now live in the transforms module.
export {
  CHANNEL_READ_CURSOR_DEBOUNCE_MS,
  OPTIMISTIC_MESSAGE_ID_PREFIX,
  hasOrgChannelMessagesCapability,
  hasOrgChannelMessagesIdempotencyCapability,
  isOptimisticChannelMessageId,
  mergeChannelMessageDelta,
  sortChannelMessages,
} from "./useCloudChannelMessages.transforms";
export type {
  CloudChannelMessagesOptions,
  CloudChannelMessagesPhase,
  CloudChannelMessagesState,
} from "./useCloudChannelMessages.transforms";

const NO_MESSAGES: CloudChannelMessage[] = [];

export function useCloudChannelMessages(
  orgId: string | null,
  channelId: string | null,
  options?: CloudChannelMessagesOptions
): CloudChannelMessagesState {
  const auth = useAtomValue(org2CloudAuthAtom);
  const bumpMessagesVersion = useSetAtom(
    bumpOrg2CloudChannelMessagesVersionAtom
  );
  const versions = useAtomValue(org2CloudChannelMessagesVersionAtom);
  const version =
    orgId && channelId
      ? selectChannelMessagesVersion(versions, orgId, channelId)
      : 0;
  const readCursorDebounceMs =
    options?.readCursorDebounceMs ?? CHANNEL_READ_CURSOR_DEBOUNCE_MS;

  // null = probe not answered yet for this sign-in.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<CloudChannelMessage[] | null>(null);
  const [messagesKey, setMessagesKey] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const listKey =
    authIdentityKey && orgId && channelId
      ? `${authIdentityKey}|${orgId}|${channelId}`
      : null;

  // Latest auth via ref (panel idiom): token-refresh writes must not
  // retrigger the fetch effect.
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  // Cloud reads may settle after a channel/account switch; a monotonic
  // counter drops late completions.
  const requestRef = useRef(0);
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  // Scope guard for callbacks that resolve outside the fetch effect.
  const listKeyRef = useRef(listKey);
  useEffect(() => {
    listKeyRef.current = listKey;
  }, [listKey]);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const nextCursorRef = useRef(nextCursor);
  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  // `p_since` cursor for the next delta read, and the last version a delta
  // (or page) already covers.
  const serverTimeRef = useRef<string | null>(null);
  // Whether the org's home endpoint advertised `orgChannelMessagesIdempotency`
  // (stamped by the page effect's probe); posts only send `p_client_key` when
  // it did, since an older backend rejects the unknown argument.
  const idempotencyRef = useRef(false);
  const versionRef = useRef(version);
  useEffect(() => {
    versionRef.current = version;
  }, [version]);
  const handledVersionRef = useRef(0);

  const lastReadSentRef = useRef<string | null>(null);

  // Identity switches are a hard visibility boundary (orgs-atom idiom).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous identity's capability answer before the asynchronous probe can publish a result
    setSupported(null);
  }, [authIdentityKey]);

  // A channel switch drops the previous transcript outright: the surface must
  // never show one channel's rows under another's header, not even for a frame.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a committed channel/identity switch must drop the previous transcript before the page effect can fetch the next one
    setMessages(null);
    setMessagesKey(null);
    setNextCursor(null);
    setUnreadCount(0);
    setError(null);
    serverTimeRef.current = null;
    idempotencyRef.current = false;
    lastReadSentRef.current = null;
  }, [authIdentityKey, orgId, channelId]);

  // One token helper for the whole channels slice (the dialogs' hook), the
  // same source `useOrgChannels` reads — a second byte-equivalent copy here
  // would keep the drift risk #610 removed alive.
  const getFreshAccessToken = useFreshChannelAccessToken();

  useCloudChannelMessagesSync({
    authIdentityKey,
    orgId,
    channelId,
    listKey,
    messagesKey,
    version,
    refreshNonce,
    fetching,
    getFreshAccessToken,
    refs: {
      requestRef,
      versionRef,
      idempotencyRef,
      serverTimeRef,
      handledVersionRef,
      listKeyRef,
      nextCursorRef,
    },
    setters: {
      setSupported,
      setMessages,
      setMessagesKey,
      setNextCursor,
      setUnreadCount,
      setError,
      setFetching,
      setRefreshNonce,
    },
  });

  // A background window can release its Realtime lease without going hidden,
  // so the `channelMessages` bump that drives the delta above may never
  // arrive. Bumping the version on the focus-regain edge routes the catch-up
  // through that SAME delta path — a full page reload here would throw away
  // any older pages the reader had already loaded.
  useEffect(() => {
    if (!authIdentityKey || !orgId || !channelId) return;
    return onWindowFocusRegained(() => {
      bumpMessagesVersion({ orgId, channelId });
    });
  }, [authIdentityKey, orgId, channelId, bumpMessagesVersion]);

  const loadOlder = useCloudChannelLoadOlder({
    orgId,
    channelId,
    nextCursor,
    loadingOlder,
    listKeyRef,
    requestRef,
    getFreshAccessToken,
    setMessages,
    setNextCursor,
    setLoadingOlder,
  });

  const { postMessage, editMessage, deleteMessage } =
    useCloudChannelMessageMutations({
      orgId,
      channelId,
      listKeyRef,
      idempotencyRef,
      authRef,
      getFreshAccessToken,
      setMessages,
    });

  const visibleMessages =
    messagesKey !== null && messagesKey === listKey ? messages : null;
  const newestMessageId =
    visibleMessages && visibleMessages.length > 0
      ? visibleMessages[visibleMessages.length - 1].id
      : null;

  const markRead = useCloudChannelReadCursor({
    orgId,
    channelId,
    listKeyRef,
    messagesRef,
    lastReadSentRef,
    getFreshAccessToken,
    setUnreadCount,
    readCursorDebounceMs,
    newestMessageId,
  });

  let phase: CloudChannelMessagesPhase;
  if (!auth) {
    phase = "signedOut";
  } else if (!orgId || !channelId) {
    phase = "loading";
  } else if (visibleMessages === null && error !== null) {
    phase = "error";
  } else if (supported === false) {
    phase = "unsupported";
  } else if (supported === null || visibleMessages === null) {
    phase = "loading";
  } else {
    phase = "ready";
  }

  const messageList = visibleMessages ?? NO_MESSAGES;
  return useMemo(
    () => ({
      phase,
      messages: messageList,
      error,
      refreshing: fetching,
      loadingOlder,
      hasOlder: nextCursor !== null,
      unreadCount,
      loadOlder,
      postMessage,
      editMessage,
      deleteMessage,
      markRead,
      currentUserId: auth?.userId ?? null,
    }),
    [
      auth?.userId,
      deleteMessage,
      editMessage,
      error,
      fetching,
      loadOlder,
      loadingOlder,
      markRead,
      messageList,
      nextCursor,
      phase,
      postMessage,
      unreadCount,
    ]
  );
}
