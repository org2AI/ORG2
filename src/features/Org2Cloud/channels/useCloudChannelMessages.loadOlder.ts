/**
 * `loadOlder` for `useCloudChannelMessages`: the previous DESCENDING keyset
 * page behind the current `nextCursor`, merged by id into the transcript.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";

import { createLogger } from "@src/hooks/logger";

import { listCloudChannelMessages } from "./channelMessagesClient";
import type { CloudChannelMessage } from "./channelMessagesTypes";
import { CHANNEL_MESSAGES_PAGE_SIZE } from "./channelMessagesTypes";
import {
  mergeChannelMessageDelta,
  sortChannelMessages,
} from "./useCloudChannelMessages.transforms";

const log = createLogger("CloudChannelMessages");

export function useCloudChannelLoadOlder(input: {
  orgId: string | null;
  channelId: string | null;
  nextCursor: string | null;
  loadingOlder: boolean;
  listKeyRef: MutableRefObject<string | null>;
  requestRef: MutableRefObject<number>;
  getFreshAccessToken: () => Promise<string>;
  setMessages: Dispatch<SetStateAction<CloudChannelMessage[] | null>>;
  setNextCursor: Dispatch<SetStateAction<string | null>>;
  setLoadingOlder: Dispatch<SetStateAction<boolean>>;
}): () => void {
  const {
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
  } = input;
  return useCallback(() => {
    if (!orgId || !channelId || !nextCursor || loadingOlder) return;
    const keyAtStart = listKeyRef.current;
    // A capped-delta full reload replaces the window AND the cursor while
    // this page is in flight; letting the stale completion land would merge
    // a discontiguous island and clobber the fresh cursor with the stale one
    // — pagination would then permanently skip the rows in between.
    const seqAtStart = requestRef.current;
    (async () => {
      setLoadingOlder(true);
      try {
        const accessToken = await getFreshAccessToken();
        const page = await listCloudChannelMessages(
          accessToken,
          orgId,
          channelId,
          { cursor: nextCursor, limit: CHANNEL_MESSAGES_PAGE_SIZE }
        );
        if (
          listKeyRef.current !== keyAtStart ||
          seqAtStart !== requestRef.current
        ) {
          return;
        }
        setMessages((current) =>
          current
            ? mergeChannelMessageDelta(current, page.messages)
            : sortChannelMessages(page.messages)
        );
        // Page mode signals "older rows exist" via nextCursor itself; the
        // hasMore field only exists in delta mode (schema defaults it false
        // here), so gating on it silently disabled pagination end to end.
        setNextCursor(page.nextCursor ?? null);
      } catch (err) {
        log.warn("cloud channel older page failed:", err);
      } finally {
        if (listKeyRef.current === keyAtStart) setLoadingOlder(false);
      }
    })().catch((err) => {
      log.warn("cloud channel older page failed:", err);
    });
  }, [
    channelId,
    getFreshAccessToken,
    listKeyRef,
    loadingOlder,
    nextCursor,
    orgId,
    requestRef,
    setLoadingOlder,
    setMessages,
    setNextCursor,
  ]);
}
