import { type MutableRefObject, useRef } from "react";

import { CHAT_FOOTER_SPACER } from "../config/chatFooterSpacer";

export interface UseChatFooterSpacerOptions {
  /** Height of the overlapping composer/input area. */
  bottomInset?: number;
}

export interface UseChatFooterSpacerReturn {
  footerSpacerHeight: number;
  virtuosoScrollerRef: MutableRefObject<HTMLDivElement | null>;
}

/**
 * The footer reserve is deliberately a stable formula. Layout observation and
 * scroll correction belong to the transcript viewport controller; keeping a
 * second observer here previously created competing animation-frame writers.
 */
export function useChatFooterSpacer({
  bottomInset = 0,
}: UseChatFooterSpacerOptions): UseChatFooterSpacerReturn {
  const virtuosoScrollerRef = useRef<HTMLDivElement | null>(null);
  const footerSpacerHeight =
    CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
    bottomInset +
    CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX;

  return { footerSpacerHeight, virtuosoScrollerRef };
}
