import { type RefObject, useCallback, useRef } from "react";

import type { MarkdownEditorMode } from "./ModeSwitch";
import { cursorPosition } from "./textareaGeometry";
import type { InlineTrigger, MarkdownTextareaEditorProps } from "./types";

interface UseMarkdownInlineTriggerOptions extends Pick<
  MarkdownTextareaEditorProps,
  "onAtMention" | "onAtMentionClose" | "onSlashCommand" | "onSlashCommandClose"
> {
  canWrite: boolean;
  activeMode: MarkdownEditorMode;
  setMode: (mode: MarkdownEditorMode) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  valueRef: RefObject<string>;
}

/**
 * Tracks the active `@` mention / `/` slash trigger inside the textarea and
 * forwards its query to the dropdown callbacks. Only one trigger is open at
 * a time; opening the other kind closes the first.
 */
export function useMarkdownInlineTrigger({
  canWrite,
  activeMode,
  setMode,
  textareaRef,
  valueRef,
  onAtMention,
  onAtMentionClose,
  onSlashCommand,
  onSlashCommandClose,
}: UseMarkdownInlineTriggerOptions) {
  const inlineTriggerRef = useRef<InlineTrigger | null>(null);

  const closeInlineTrigger = useCallback(() => {
    const trigger = inlineTriggerRef.current;
    inlineTriggerRef.current = null;
    if (trigger?.kind === "mention") onAtMentionClose?.();
    if (trigger?.kind === "slash") onSlashCommandClose?.();
  }, [onAtMentionClose, onSlashCommandClose]);

  const setInlineTrigger = useCallback(
    (nextTrigger: InlineTrigger) => {
      const previousTrigger = inlineTriggerRef.current;
      if (previousTrigger && previousTrigger.kind !== nextTrigger.kind) {
        if (previousTrigger.kind === "mention") onAtMentionClose?.();
        if (previousTrigger.kind === "slash") onSlashCommandClose?.();
      }
      inlineTriggerRef.current = nextTrigger;
    },
    [onAtMentionClose, onSlashCommandClose]
  );

  const openInlineTrigger = useCallback(
    (kind: InlineTrigger["kind"], hasTriggerCharacter = false) => {
      if (!canWrite) return;
      if (activeMode === "preview") setMode("write");
      const textarea = textareaRef.current;
      const start = textarea?.selectionEnd ?? valueRef.current.length;
      setInlineTrigger({ kind, start, hasTriggerCharacter });
      if (kind === "mention") {
        onAtMention?.("", textarea ? cursorPosition(textarea) : { x: 0, y: 0 });
      } else {
        onSlashCommand?.("");
      }
      textarea?.focus();
    },
    [
      activeMode,
      canWrite,
      onAtMention,
      onSlashCommand,
      setInlineTrigger,
      setMode,
      textareaRef,
      valueRef,
    ]
  );

  const updateInlineTrigger = useCallback(
    (nextValue: string, textarea: HTMLTextAreaElement) => {
      const trigger = inlineTriggerRef.current;
      if (!trigger) return;
      const cursor = textarea.selectionStart;
      const query = nextValue.slice(trigger.start, cursor);
      if (cursor < trigger.start || /\s/u.test(query)) {
        closeInlineTrigger();
        return;
      }
      if (trigger.kind === "mention") {
        onAtMention?.(query, cursorPosition(textarea));
      } else {
        onSlashCommand?.(query);
      }
    },
    [closeInlineTrigger, onAtMention, onSlashCommand]
  );

  return {
    inlineTriggerRef,
    closeInlineTrigger,
    setInlineTrigger,
    openInlineTrigger,
    updateInlineTrigger,
  };
}
