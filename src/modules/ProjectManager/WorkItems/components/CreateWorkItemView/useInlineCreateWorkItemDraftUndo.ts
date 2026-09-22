import { useCallback } from "react";

import { mapWorkItemUpdatesToDraftPatch } from "@src/hooks/project";
import { useUndoStackWithRestore } from "@src/hooks/ui/useUndoableState";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

interface UseInlineCreateWorkItemDraftUndoOptions {
  draft: WorkItemDraft;
  setDraft: (draft: WorkItemDraft) => void;
  updateDraft: (patch: Partial<WorkItemDraft>) => void;
}

/**
 * Undoable draft edits for the inline creator: every title, description and
 * property change snapshots the previous draft onto the keyboard undo stack.
 */
export function useInlineCreateWorkItemDraftUndo({
  draft,
  setDraft,
  updateDraft,
}: UseInlineCreateWorkItemDraftUndoOptions) {
  const undoStack = useUndoStackWithRestore<WorkItemDraft>({
    keyboardShortcut: true,
    currentValue: draft,
    onRestore: (previous) => setDraft(previous),
  });

  const updateDraftWithUndo = useCallback(
    (updates: Partial<WorkItemDraft>) => {
      undoStack.snapshot(draft);
      updateDraft(updates);
    },
    [draft, undoStack, updateDraft]
  );

  const handleTitleChange = useCallback(
    (name: string) => updateDraftWithUndo({ name }),
    [updateDraftWithUndo]
  );

  const handleDescriptionChange = useCallback(
    (markdown: string, _text: string) =>
      updateDraftWithUndo({ description: markdown }),
    [updateDraftWithUndo]
  );

  const handlePropertyUpdate = useCallback(
    (updates: Partial<WorkItemExtended>) => {
      updateDraftWithUndo(mapWorkItemUpdatesToDraftPatch(updates));
    },
    [updateDraftWithUndo]
  );

  return {
    updateDraftWithUndo,
    handleTitleChange,
    handleDescriptionChange,
    handlePropertyUpdate,
  };
}
