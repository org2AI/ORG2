import React, {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { MarkdownContent } from "@src/components/MarkdownContent";
import "@src/components/MarkdownFormattingToolbar/index.css";
import Textarea from "@src/components/Textarea";

import MarkdownTextareaToolbar from "./MarkdownTextareaToolbar";
import MarkdownEditorModeSwitch, {
  type MarkdownEditorMode,
} from "./ModeSwitch";
import {
  type MarkdownTextareaEdit,
  type MarkdownTextareaFormat,
  formatMarkdownTextareaSelection,
  insertMarkdownTextareaText,
  markdownTextareaToPlainText,
} from "./formatting";
import { textOffsetAtPoint } from "./textareaGeometry";
import type {
  MarkdownTextareaEditorProps,
  MarkdownTextareaEditorRef,
  MarkdownTextareaInsertOptions,
} from "./types";
import { useMarkdownInlineTrigger } from "./useMarkdownInlineTrigger";
import { useMarkdownTextareaHandle } from "./useMarkdownTextareaHandle";
import { useMarkdownTextareaKeyDown } from "./useMarkdownTextareaKeyDown";

export { default as MarkdownEditorModeSwitch } from "./ModeSwitch";
export type { MarkdownEditorMode } from "./ModeSwitch";
export type { MarkdownTextareaEditorRef } from "./types";

/**
 * Markdown source editor shared by comments, issues, PRs, and project
 * descriptions. Write uses one native textarea; Preview mounts the existing
 * lazy Markdown renderer only on demand.
 */
const MarkdownTextareaEditor = forwardRef<
  MarkdownTextareaEditorRef,
  MarkdownTextareaEditorProps
>(function MarkdownTextareaEditor(
  {
    value,
    onChange,
    placeholder,
    minHeight = 72,
    minRows = 3,
    maxHeight = 240,
    maxLength,
    disabled = false,
    editable = true,
    autoFocus = false,
    appearance = "plain",
    onSubmit,
    onImageInsert,
    onAtMention,
    onAtMentionClose,
    onSlashCommand,
    onSlashCommandClose,
    onKeyDownForDropdown,
    onKeyDownForSlashDropdown,
    dataTestId,
    className = "",
    mode: controlledMode,
    onModeChange,
  },
  ref
) {
  const { t } = useTranslation("sessions");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  const [internalMode, setInternalMode] = useState<MarkdownEditorMode>("write");
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(
    null
  );
  const canWrite = editable && !disabled;
  const mode = controlledMode ?? internalMode;
  const activeMode = canWrite ? mode : "preview";

  const setMode = useCallback(
    (nextMode: MarkdownEditorMode) => {
      if (controlledMode === undefined) setInternalMode(nextMode);
      onModeChange?.(nextMode);
    },
    [controlledMode, onModeChange]
  );

  const emitChange = useCallback(
    (nextValue: string) => {
      if (maxLength !== undefined && nextValue.length > maxLength) return false;
      valueRef.current = nextValue;
      onChange(nextValue, markdownTextareaToPlainText(nextValue));
      return true;
    },
    [maxLength, onChange]
  );

  const {
    inlineTriggerRef,
    closeInlineTrigger,
    setInlineTrigger,
    openInlineTrigger,
    updateInlineTrigger,
  } = useMarkdownInlineTrigger({
    canWrite,
    activeMode,
    setMode,
    textareaRef,
    valueRef,
    onAtMention,
    onAtMentionClose,
    onSlashCommand,
    onSlashCommandClose,
  });

  const insertEdit = useCallback(
    (edit: MarkdownTextareaEdit) => {
      if (!emitChange(edit.value)) return;
      pendingSelectionRef.current = {
        start: edit.selectionStart,
        end: edit.selectionEnd,
      };
      closeInlineTrigger();
    },
    [closeInlineTrigger, emitChange]
  );

  const insertText = useCallback(
    (text: string, options?: MarkdownTextareaInsertOptions) => {
      if (!text || !canWrite) return;
      const textarea = textareaRef.current;
      const fallbackEnd = textarea?.selectionEnd ?? valueRef.current.length;
      const pointOffset = textarea
        ? textOffsetAtPoint(textarea, options?.clientX, options?.clientY)
        : null;
      const insertionOffset = pointOffset ?? fallbackEnd;
      insertEdit(
        insertMarkdownTextareaText(
          {
            value: valueRef.current,
            start: insertionOffset,
            end: insertionOffset,
          },
          text,
          options?.separateFromAdjacentText
        )
      );
    },
    [canWrite, insertEdit]
  );

  const focus = useCallback(() => {
    if (!canWrite) return;
    if (activeMode === "preview") {
      pendingSelectionRef.current = {
        start: valueRef.current.length,
        end: valueRef.current.length,
      };
      setMode("write");
      return;
    }
    textareaRef.current?.focus();
  }, [activeMode, canWrite, setMode]);

  useMarkdownTextareaHandle({
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
  });

  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  useLayoutEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (activeMode !== "write" || !pendingSelection || !textarea) return;
    pendingSelectionRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
  }, [activeMode, value]);

  const selectMode = useCallback(
    (nextMode: MarkdownEditorMode) => {
      if (!canWrite || nextMode === mode) return;
      if (nextMode === "preview") {
        const textarea = textareaRef.current;
        if (textarea) {
          pendingSelectionRef.current = {
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
          };
        }
        closeInlineTrigger();
      }
      setMode(nextMode);
    },
    [canWrite, closeInlineTrigger, mode, setMode]
  );

  const applyFormat = useCallback(
    (format: MarkdownTextareaFormat) => {
      const textarea = textareaRef.current;
      if (!textarea || !canWrite) return;
      insertEdit(
        formatMarkdownTextareaSelection(
          {
            value: textarea.value,
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
          },
          format
        )
      );
    },
    [canWrite, insertEdit]
  );

  const handleKeyDown = useMarkdownTextareaKeyDown({
    value,
    inlineTriggerRef,
    setInlineTrigger,
    closeInlineTrigger,
    applyFormat,
    onSubmit,
    onAtMention,
    onSlashCommand,
    onKeyDownForDropdown,
    onKeyDownForSlashDropdown,
  });

  const surfaceClassName =
    appearance === "outlined"
      ? "composer-surface-shadow relative rounded-md border border-border-2 bg-primary-container"
      : "";

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col ${surfaceClassName} ${className}`.trim()}
      data-testid={dataTestId}
      data-markdown-textarea-editor
    >
      {activeMode === "write" ? (
        <div className="flex min-h-0 flex-col">
          <MarkdownTextareaToolbar
            canWrite={canWrite}
            dataTestId={dataTestId}
            onApplyFormat={applyFormat}
          />
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(nextValue, event) => {
              emitChange(nextValue);
              updateInlineTrigger(nextValue, event.currentTarget);
            }}
            placeholder={placeholder}
            size="small"
            appearance="bare"
            autoSize={{ minRows, maxRows: 10 }}
            rows={minRows}
            maxLength={maxLength}
            disabled={!canWrite}
            autoFocus={autoFocus}
            spellCheck
            textareaStyle={{ minHeight, maxHeight, overflowY: "auto" }}
            data-testid={dataTestId ? `${dataTestId}-textarea` : undefined}
            onPaste={(event) => {
              if (!onImageInsert) return;
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length === 0) return;
              event.preventDefault();
              onImageInsert(files);
            }}
            onDrop={(event) => {
              if (!onImageInsert) return;
              const files = Array.from(event.dataTransfer.files).filter(
                (file) => file.type.startsWith("image/")
              );
              if (files.length === 0) return;
              event.preventDefault();
              onImageInsert(files);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-col">
          <div
            className="min-h-0 overflow-y-auto px-2 py-2"
            style={{ minHeight, maxHeight }}
            role="region"
            aria-label={t("common:common.preview", "Preview")}
            data-testid={dataTestId ? `${dataTestId}-preview` : undefined}
            data-markdown-preview
          >
            <MarkdownContent
              body={value}
              emptyText={t(
                "common:common.nothingToPreview",
                "Nothing to preview"
              )}
              clamped={false}
            />
          </div>
        </div>
      )}
      {canWrite && controlledMode === undefined ? (
        <div className="flex min-h-8 items-center px-1.5 py-1">
          <MarkdownEditorModeSwitch
            mode={mode}
            onModeChange={selectMode}
            dataTestId={dataTestId ? `${dataTestId}-mode-switch` : undefined}
          />
        </div>
      ) : null}
    </div>
  );
});

MarkdownTextareaEditor.displayName = "MarkdownTextareaEditor";

export default MarkdownTextareaEditor;
