import { useCallback, useRef, useState } from "react";

import type {
  MarkdownEditorMode,
  MarkdownTextareaEditorRef,
} from "@src/components/MarkdownTextareaEditor";
import { useSessionReferenceDropTarget } from "@src/features/Org2Cloud/useSessionReferenceDropTarget";
import { useElementDimensions } from "@src/hooks/ui/layout/useElementDimensions";

interface UsePrConversationComposerOptions {
  controlledDraft?: string;
  onDraftChange?: (draft: string) => void;
  submittingComment: boolean;
  onAddComment: (body: string) => Promise<void>;
}

/**
 * Conversation composer state: the draft (controlled when the host passes
 * one), the editor mode, the measured dock height the timeline pads under,
 * session-reference drops, and posting the draft as a comment.
 */
export function usePrConversationComposer({
  controlledDraft,
  onDraftChange,
  submittingComment,
  onAddComment,
}: UsePrConversationComposerOptions) {
  const [internalDraft, setInternalDraft] = useState("");
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>("write");
  const draft = controlledDraft ?? internalDraft;
  const updateDraft = useCallback(
    (nextDraft: string) => {
      if (controlledDraft !== undefined) {
        onDraftChange?.(nextDraft);
        return;
      }
      setInternalDraft(nextDraft);
    },
    [controlledDraft, onDraftChange]
  );
  const editorRef = useRef<MarkdownTextareaEditorRef>(null);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const measuredComposerHeight = useElementDimensions(composerDockRef, {
    dimension: "height",
  });
  const composerBottomInset = Math.max(240, measuredComposerHeight);
  const insertDroppedReference = useCallback(
    (text: string, dropPoint?: { clientX: number; clientY: number }) => {
      editorRef.current?.insertText(text, {
        separateFromAdjacentText: true,
        clientX: dropPoint?.clientX,
        clientY: dropPoint?.clientY,
      });
    },
    []
  );
  const { isDragOver } = useSessionReferenceDropTarget({
    elementRef: dropTargetRef,
    onInsertText: insertDroppedReference,
  });

  const handleComment = useCallback(async () => {
    const value = draft.trim();
    if (!value || submittingComment) return;
    await onAddComment(value);
    updateDraft("");
    setEditorMode("write");
  }, [draft, submittingComment, onAddComment, updateDraft]);

  return {
    draft,
    updateDraft,
    editorMode,
    setEditorMode,
    editorRef,
    dropTargetRef,
    composerDockRef,
    composerBottomInset,
    isDragOver,
    handleComment,
  };
}
