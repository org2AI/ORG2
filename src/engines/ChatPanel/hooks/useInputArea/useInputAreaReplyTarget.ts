import { useCallback, useMemo } from "react";

import { createLogger } from "@src/hooks/logger";
import { useSessionReplyField } from "@src/hooks/session/useSessionPatch";

const logger = createLogger("useInputArea");

export function useInputAreaReplyTarget(draftSessionId: string) {
  // Per-session reply target (P3). The chat-item Reply action writes a
  // chunk id here via `setReplyTarget`; the composer banner reads it to
  // decide whether to render `ReplyInfoDisplay`. Dismissing the banner
  // (or sending the message) calls `clearReplyTarget`.
  const { replyTargetEventId, clearReplyTarget } =
    useSessionReplyField(draftSessionId);

  // ============================================
  // Effective replyInfo (P3)
  // ============================================
  //
  // The persisted `replyTargetEventId` on the session row (read via
  // `useSessionReplyField`) is the *only* source of truth for whether
  // the composer's reply banner is open. The `replyInfo` we expose
  // here is just a derived view-model in the legacy shape the UI
  // components (`InputArea`, `ReplyInfoDisplay`) already consume.
  const effectiveReplyInfo = useMemo<{
    isReply: boolean;
    info?: { type: string; eventId?: string };
  }>(
    () =>
      replyTargetEventId
        ? {
            isReply: true,
            info: { type: "reply", eventId: replyTargetEventId },
          }
        : { isReply: false },
    [replyTargetEventId]
  );

  // The legacy `setReplyInfo` callback signature is preserved so the
  // call sites (`InputArea`'s "× close banner" buttons) don't need to
  // know about the persisted column. We accept the same shape they
  // already pass and translate `isReply: false` into a backend
  // `clearReplyTarget()` call. There is no in-tree caller passing
  // `isReply: true` today — that path would belong to a future
  // chat-item Reply trigger and should call `setReplyTarget(eventId)`
  // directly via `useSessionReplyField`, not through this shim.
  const setReplyInfoBridge = useCallback(
    (next: { isReply: boolean; info?: { type: string; eventId?: string } }) => {
      if (!draftSessionId) return;
      if (!next.isReply && replyTargetEventId) {
        void clearReplyTarget().catch((err: unknown) => {
          logger.warn("clearReplyTarget(bridge) failed", err);
        });
      }
    },
    [clearReplyTarget, draftSessionId, replyTargetEventId]
  );

  return {
    replyTargetEventId,
    clearReplyTarget,
    effectiveReplyInfo,
    setReplyInfoBridge,
  };
}
