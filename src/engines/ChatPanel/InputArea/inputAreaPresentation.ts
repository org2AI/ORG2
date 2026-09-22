export type InputAreaPresentation = "default" | "contextual";

interface CompactComposerLayoutInput {
  compactInputEnabled: boolean;
  /** The composer is hosted by a ChatPanel that fills the app window. */
  chatPanelFullScreen: boolean;
  isEditMode: boolean;
  hasImages: boolean;
  isCiteCode: boolean;
  isReply: boolean;
  editorMultiline: boolean;
}

export function isContextualInputAreaPresentation(
  presentation: InputAreaPresentation
): boolean {
  return presentation === "contextual";
}

/**
 * Resolve whether InputArea can use the shared one-row capsule without hiding
 * valid editor content. The capsule is opt-in through the compact-input
 * preference and only applies inside the full-screen chat panel; everywhere
 * else, and whenever attachments, a citation, a reply, or a multiline
 * document need room, the composer keeps the stacked editor.
 */
export function shouldUseCompactComposerLayout({
  compactInputEnabled,
  chatPanelFullScreen,
  isEditMode,
  hasImages,
  isCiteCode,
  isReply,
  editorMultiline,
}: CompactComposerLayoutInput): boolean {
  return (
    compactInputEnabled &&
    chatPanelFullScreen &&
    !isEditMode &&
    !hasImages &&
    !isCiteCode &&
    !isReply &&
    !editorMultiline
  );
}
