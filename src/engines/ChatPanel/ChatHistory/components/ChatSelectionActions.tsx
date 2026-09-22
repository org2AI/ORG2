/**
 * Selection actions for the chat transcript.
 *
 * Owns the transcript's text-selection lifecycle and the two write
 * boundaries a selected passage has: a pin in the workstation trail, or a
 * quoted reply in this session's composer. The transcript itself stays a
 * renderer.
 *
 * Presented as the inline bar rather than a stacked menu: two short actions
 * floating above the passage read faster than a dropdown covering it.
 */
import React, { memo, useCallback } from "react";

import { resolveSelectionAnchorId } from "@src/engines/ChatPanel/chatSelections/transcriptAnchor";
import { useChatQuotedSelection } from "@src/engines/ChatPanel/chatSelections/useChatQuotedSelection";
import { usePinnedChatSelections } from "@src/engines/ChatPanel/chatSelections/usePinnedChatSelections";
import {
  TextSelectionDropdown,
  useTextSelectionDropdown,
} from "@src/scaffold/ContextMenu/exports";

interface ChatSelectionActionsProps {
  containerRef: React.RefObject<HTMLElement | null>;
  sessionId: string;
}

const ChatSelectionActions: React.FC<ChatSelectionActionsProps> = memo(
  ({ containerRef, sessionId }) => {
    const { visible, position, selectedText, hideDropdown } =
      useTextSelectionDropdown({ anchorToSelection: true, containerRef });
    const { pin } = usePinnedChatSelections(sessionId);
    const { quoteSelection } = useChatQuotedSelection(sessionId);

    const handlePin = useCallback(
      (text: string) => {
        // The menu suppresses mousedown, so the range that produced this text
        // is still live and can name the turn the passage came from.
        pin(text, resolveSelectionAnchorId(window.getSelection()));
      },
      [pin]
    );

    return (
      <TextSelectionDropdown
        visible={visible}
        position={position}
        selectedText={selectedText}
        source="chat"
        layout="inline"
        onClose={hideDropdown}
        onPin={handlePin}
        onReply={quoteSelection}
      />
    );
  }
);

ChatSelectionActions.displayName = "ChatSelectionActions";

export default ChatSelectionActions;
