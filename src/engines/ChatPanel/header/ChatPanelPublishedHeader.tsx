import React, { memo } from "react";

import { PublishedHeaderSlotsView } from "@src/components/WindowChrome";

import {
  CHAT_PANEL_HEADER_DRAG_STYLE,
  CHAT_PANEL_HEADER_NO_DRAG_STYLE,
  CHAT_PANEL_HEADER_RIGHT_PADDING_CLASS,
} from "./ChatPanelHeaderPrimitives";
import type { ChatPanelHeaderSlots } from "./chatPanelHeaderSlots";

interface ChatPanelPublishedHeaderProps {
  slots: ChatPanelHeaderSlots | null;
  windowsHost: boolean;
  /**
   * Space reserved at the left edge for the host window's own controls and the
   * collapsed-sidebar button. Replaces the slot view's default text inset when
   * set, and is only passed once this row inherited the pane's top edge.
   */
  leadingInsetPx?: number;
  /** Space kept clear at the right edge for the window's pinned collapse toggles. */
  trailingInsetPx?: number;
  /** Moves the insets above with a station opening or closing. */
  insetTransitionClassName?: string;
}

/**
 * Chat-pane counterpart of My Station's shared 36px published header. The chat
 * header draws no bottom rule in any layout.
 */
export const ChatPanelPublishedHeader: React.FC<ChatPanelPublishedHeaderProps> =
  memo(
    ({
      slots,
      windowsHost,
      leadingInsetPx,
      trailingInsetPx,
      insetTransitionClassName = "",
    }) => {
      if (!slots || slots.hidden) return null;

      return (
        <div
          className={`relative z-40 flex h-9 shrink-0 items-center gap-2 ${CHAT_PANEL_HEADER_RIGHT_PADDING_CLASS} ${insetTransitionClassName}`}
          data-testid="chat-panel-published-header"
          data-tauri-drag-region={windowsHost ? undefined : true}
          style={{
            ...(windowsHost
              ? CHAT_PANEL_HEADER_NO_DRAG_STYLE
              : CHAT_PANEL_HEADER_DRAG_STYLE),
            paddingLeft: leadingInsetPx,
            paddingRight: trailingInsetPx,
          }}
        >
          <PublishedHeaderSlotsView
            slots={slots}
            paddingLeftClassName={leadingInsetPx === undefined ? undefined : ""}
          />
        </div>
      );
    }
  );

ChatPanelPublishedHeader.displayName = "ChatPanelPublishedHeader";
