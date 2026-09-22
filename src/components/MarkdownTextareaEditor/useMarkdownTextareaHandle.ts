import { type ForwardedRef, type RefObject, useImperativeHandle } from "react";

import { serializePillNode } from "@src/components/ComposerInput/utils";

import {
  type MarkdownTextareaEdit,
  insertMarkdownTextareaText,
  markdownTextareaToPlainText,
} from "./formatting";
import type {
  InlineTrigger,
  MarkdownTextareaEditorRef,
  MarkdownTextareaInsertOptions,
} from "./types";

interface UseMarkdownTextareaHandleOptions {
  ref: ForwardedRef<MarkdownTextareaEditorRef>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  valueRef: RefObject<string>;
  pendingSelectionRef: RefObject<{ start: number; end: number } | null>;
  inlineTriggerRef: RefObject<InlineTrigger | null>;
  emitChange: (nextValue: string) => boolean;
  focus: () => void;
  insertEdit: (edit: MarkdownTextareaEdit) => void;
  insertText: (text: string, options?: MarkdownTextareaInsertOptions) => void;
  openInlineTrigger: (
    kind: InlineTrigger["kind"],
    hasTriggerCharacter?: boolean
  ) => void;
}

/** The imperative surface composers drive: content, insertion, and mention control. */
export function useMarkdownTextareaHandle({
  ref,
  textareaRef,
  valueRef,
  pendingSelectionRef,
  inlineTriggerRef,
  emitChange,
  focus,
  insertEdit,
  insertText,
  openInlineTrigger,
}: UseMarkdownTextareaHandleOptions): void {
  useImperativeHandle(
    ref,
    () => ({
      focus,
      getText: () => markdownTextareaToPlainText(valueRef.current),
      getMarkdown: () => valueRef.current,
      setContent: (content) => {
        if (emitChange(content)) {
          pendingSelectionRef.current = {
            start: content.length,
            end: content.length,
          };
        }
      },
      clear: () => {
        if (emitChange("")) pendingSelectionRef.current = { start: 0, end: 0 };
      },
      isEmpty: () => valueRef.current.trim().length === 0,
      insertImage: (src, alt = "image") =>
        insertText(`![${alt.replace(/[[\]]/g, "")}](${src})`, {
          separateFromAdjacentText: true,
        }),
      insertText,
      insertFilePill: (filePath, isFolder = false, iconType, displayName) => {
        const trigger = inlineTriggerRef.current;
        const textarea = textareaRef.current;
        let insertionOffset = textarea?.selectionEnd ?? valueRef.current.length;
        if (trigger) {
          const cursor = textarea?.selectionEnd ?? valueRef.current.length;
          const from = trigger.hasTriggerCharacter
            ? Math.max(0, trigger.start - 1)
            : trigger.start;
          valueRef.current = `${valueRef.current.slice(0, from)}${valueRef.current.slice(cursor)}`;
          insertionOffset = from;
        }
        const resolvedIconType = iconType ?? (isFolder ? "folder" : "file");
        insertEdit(
          insertMarkdownTextareaText(
            {
              value: valueRef.current,
              start: insertionOffset,
              end: insertionOffset,
            },
            serializePillNode({
              filePath,
              fileName: displayName || filePath.split("/").pop() || filePath,
              iconType: resolvedIconType,
            }),
            true
          )
        );
      },
      triggerAtMention: () => openInlineTrigger("mention"),
      consumeMentionQuery: () => {
        const trigger = inlineTriggerRef.current;
        if (!trigger || trigger.kind !== "mention") return;
        const textarea = textareaRef.current;
        const cursor = textarea?.selectionEnd ?? valueRef.current.length;
        const from = trigger.hasTriggerCharacter
          ? Math.max(0, trigger.start - 1)
          : trigger.start;
        insertEdit({
          value: `${valueRef.current.slice(0, from)}${valueRef.current.slice(cursor)}`,
          selectionStart: from,
          selectionEnd: from,
        });
      },
    }),
    [
      emitChange,
      focus,
      inlineTriggerRef,
      insertEdit,
      insertText,
      openInlineTrigger,
      pendingSelectionRef,
      textareaRef,
      valueRef,
    ]
  );
}
