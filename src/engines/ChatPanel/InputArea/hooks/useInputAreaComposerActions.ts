import { useCallback } from "react";

import type { SessionFollowUpSuggestion } from "@src/api/services/sessionFollowUpSuggestions";
import Message from "@src/components/Message";
import type { UseInputAreaReturn } from "@src/engines/ChatPanel/hooks/useInputArea/types";

interface UseInputAreaComposerActionsOptions {
  composerInputRef: UseInputAreaReturn["composerInputRef"];
  handleModeSelect: UseInputAreaReturn["handleModeSelect"];
  handleContextMenuClose: () => void;
  handleUploadClick: UseInputAreaReturn["handleUploadClick"];
  onEditSendNow: ((text: string, imageDataUrls?: string[]) => void) | undefined;
  attachedImageDataUrls: string[];
  clearAttachedImages: UseInputAreaReturn["clearAttachedImages"];
  setReplyInfo: UseInputAreaReturn["setReplyInfo"];
  handleDivSubmit: UseInputAreaReturn["handleDivSubmit"];
  onFollowUpSuggestionSent: (() => void) | undefined;
}

export function useInputAreaComposerActions({
  composerInputRef,
  handleModeSelect,
  handleContextMenuClose,
  handleUploadClick,
  onEditSendNow,
  attachedImageDataUrls,
  clearAttachedImages,
  setReplyInfo,
  handleDivSubmit,
  onFollowUpSuggestionSent,
}: UseInputAreaComposerActionsOptions) {
  const handleContextModeSelect = useCallback(
    (mode: Parameters<typeof handleModeSelect>[0]) => {
      handleModeSelect(mode);
      composerInputRef.current?.consumeMentionQuery();
      handleContextMenuClose();
    },
    [composerInputRef, handleContextMenuClose, handleModeSelect]
  );
  const handleContextImageUpload = useCallback(() => {
    composerInputRef.current?.consumeMentionQuery();
    handleUploadClick();
  }, [composerInputRef, handleUploadClick]);

  const handleEditSendNow = useCallback(() => {
    if (!composerInputRef.current || !onEditSendNow) return;
    const text = composerInputRef.current.getTextWithPills().trim();
    if (!text) return;
    onEditSendNow(text, attachedImageDataUrls);
    if (attachedImageDataUrls.length > 0) clearAttachedImages();
  }, [
    attachedImageDataUrls,
    clearAttachedImages,
    onEditSendNow,
    composerInputRef,
  ]);

  const clearReplyInfo = useCallback(
    () => setReplyInfo({ isReply: false }),
    [setReplyInfo]
  );
  // Queue-vs-direct is decided by handleSessChatSubmit against the
  // turn-lifecycle FSM — the composer just forwards the captured text.
  const submitMessage = useCallback(
    (capturedText?: string) => {
      void handleDivSubmit({ capturedText }).catch((error: unknown) => {
        Message.error(String(error));
      });
    },
    [handleDivSubmit]
  );
  const submitFollowUpSuggestion = useCallback(
    (suggestion: SessionFollowUpSuggestion) => {
      void handleDivSubmit({
        capturedText: suggestion.prompt,
        source: "explicit-action",
        onSubmitted: onFollowUpSuggestionSent,
      }).catch((error: unknown) => {
        Message.error(String(error));
      });
    },
    [handleDivSubmit, onFollowUpSuggestionSent]
  );

  return {
    handleContextModeSelect,
    handleContextImageUpload,
    handleEditSendNow,
    clearReplyInfo,
    submitMessage,
    submitFollowUpSuggestion,
  };
}
