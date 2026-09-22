/**
 * ChatQuotePreview
 *
 * The passage this message replies to, shown above the composer as one tile
 * in the attachment row — same 48px height, radius and hover-remove
 * affordance as an image attachment, because it is the same kind of thing:
 * something attached to the message you are about to send.
 *
 * Written by the transcript's selection menu ("Reply"); cleared here or on
 * send.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { useChatQuotedSelection } from "@src/engines/ChatPanel/chatSelections/useChatQuotedSelection";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";

interface ChatQuotePreviewProps {
  /** Session whose composer this is; quotes are per session. */
  sessionId: string | null | undefined;
  className?: string;
}

const ChatQuotePreview: React.FC<ChatQuotePreviewProps> = memo(
  ({ sessionId, className = "px-3 pb-0.5" }) => {
    const { t } = useTranslation("common");
    const { quotedText, clearQuotedSelection } =
      useChatQuotedSelection(sessionId);

    if (!quotedText) return null;

    return (
      <div className={`flex ${className}`} data-testid="chat-quote-preview">
        {/* No title/tooltip: the tile already shows the passage, and a native
            tooltip repeating it covers the composer on every hover. */}
        <div className="group relative inline-flex h-12 max-w-[240px] min-w-0 shrink-0 items-center gap-2 rounded-md border border-border-2 bg-fill-1 px-2 transition-[border-color] duration-200 ease-in-out hover:border-border-3">
          <span
            aria-hidden
            className="h-7 w-0.5 shrink-0 rounded-full bg-border-3"
          />
          <span className="line-clamp-2 min-w-0 text-[11px] leading-[14px] text-text-2">
            {quotedText}
          </span>
          <Button
            hoverTone="danger"
            size="sidebar"
            shape="circle"
            iconOnly
            onClick={clearQuotedSelection}
            className="absolute -top-1 -right-1 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t("selectionMenu.clearQuotedSelection")}
            data-testid="chat-quote-preview-remove"
            icon={
              <HugeiconsIcon
                icon={Cancel01Icon}
                data-icon="x"
                size={12}
                strokeWidth={2}
              />
            }
          />
        </div>
      </div>
    );
  }
);

ChatQuotePreview.displayName = "ChatQuotePreview";

export default ChatQuotePreview;
