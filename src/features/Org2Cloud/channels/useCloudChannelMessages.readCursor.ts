/**
 * Read-cursor write for `useCloudChannelMessages`: debounced
 * `cloud_set_channel_read_cursor` once the newest server row is on screen
 * (the transcript rests scrolled to the bottom, so "newest row rendered
 * while the document is visible" IS the visible case).
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";

import { setCloudChannelReadCursor } from "./channelMessagesClient";
import type { CloudChannelMessage } from "./channelMessagesTypes";
import { newestServerMessageAt } from "./useCloudChannelMessages.transforms";

const log = createLogger("CloudChannelMessages");

export function useCloudChannelReadCursor(input: {
  orgId: string | null;
  channelId: string | null;
  listKeyRef: MutableRefObject<string | null>;
  messagesRef: MutableRefObject<CloudChannelMessage[] | null>;
  /** Reset by the hook on every channel/identity switch. */
  lastReadSentRef: MutableRefObject<string | null>;
  getFreshAccessToken: () => Promise<string>;
  setUnreadCount: Dispatch<SetStateAction<number>>;
  readCursorDebounceMs: number;
  /** Newest visible row id; the hook marks read when it changes. */
  newestMessageId: string | null;
}): () => void {
  const {
    orgId,
    channelId,
    listKeyRef,
    messagesRef,
    lastReadSentRef,
    getFreshAccessToken,
    setUnreadCount,
    readCursorDebounceMs,
    newestMessageId,
  } = input;
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeReadCursor = useCallback(async (): Promise<void> => {
    const keyAtStart = listKeyRef.current;
    if (!orgId || !channelId || !keyAtStart) return;
    const lastReadAt = newestServerMessageAt(messagesRef.current ?? []);
    if (!lastReadAt || lastReadSentRef.current === lastReadAt) return;
    lastReadSentRef.current = lastReadAt;
    try {
      const accessToken = await getFreshAccessToken();
      const result = await setCloudChannelReadCursor(
        accessToken,
        orgId,
        channelId,
        lastReadAt
      );
      if (listKeyRef.current !== keyAtStart) return;
      setUnreadCount(result.unreadCount);
    } catch (err) {
      // Let the next new row retry instead of pinning the cursor forward.
      lastReadSentRef.current = null;
      log.warn("cloud channel read cursor failed:", err);
    }
  }, [
    channelId,
    getFreshAccessToken,
    lastReadSentRef,
    listKeyRef,
    messagesRef,
    orgId,
    setUnreadCount,
  ]);

  const markRead = useCallback(() => {
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
    readTimerRef.current = setTimeout(() => {
      readTimerRef.current = null;
      // Re-check at fire: a timer armed <debounce before the window hid
      // would otherwise write a read cursor for rows nobody is seeing.
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      writeReadCursor().catch((err) => {
        log.warn("cloud channel read cursor failed:", err);
      });
    }, readCursorDebounceMs);
  }, [readCursorDebounceMs, writeReadCursor]);

  useEffect(
    () => () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    },
    []
  );

  // The transcript rests scrolled to its newest row, so a rendered newest row
  // in a visible document IS "the newest message is visible". A hidden
  // document (background window) must not consume the unread badge.
  useEffect(() => {
    if (!newestMessageId) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    markRead();
  }, [newestMessageId, markRead]);

  return markRead;
}
