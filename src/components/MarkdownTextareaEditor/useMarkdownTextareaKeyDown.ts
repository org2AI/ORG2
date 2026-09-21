import type React from "react";
import { type RefObject, useCallback } from "react";

import type { MarkdownTextareaFormat } from "./formatting";
import { cursorPosition } from "./textareaGeometry";
import type { InlineTrigger, MarkdownTextareaEditorProps } from "./types";

const DROPDOWN_KEYS = ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"];

interface UseMarkdownTextareaKeyDownOptions extends Pick<
  MarkdownTextareaEditorProps,
  | "onSubmit"
  | "onAtMention"
  | "onSlashCommand"
  | "onKeyDownForDropdown"
  | "onKeyDownForSlashDropdown"
> {
  value: string;
  inlineTriggerRef: RefObject<InlineTrigger | null>;
  setInlineTrigger: (trigger: InlineTrigger) => void;
  closeInlineTrigger: () => void;
  applyFormat: (format: MarkdownTextareaFormat) => void;
}

/**
 * Keyboard routing for the Write textarea: dropdown navigation while a
 * trigger is open, Cmd/Ctrl+Enter submit, Escape to close the trigger,
 * `@` / `/` to open one, and Cmd/Ctrl+B / +I formatting shortcuts.
 */
export function useMarkdownTextareaKeyDown({
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
}: UseMarkdownTextareaKeyDownOptions) {
  return useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const trigger = inlineTriggerRef.current;
      if (trigger && DROPDOWN_KEYS.includes(event.key)) {
        const handled =
          trigger.kind === "mention"
            ? onKeyDownForDropdown?.(event.nativeEvent)
            : onKeyDownForSlashDropdown?.(event.nativeEvent);
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        onSubmit?.();
        return;
      }
      if (event.key === "Escape" && trigger) {
        event.preventDefault();
        closeInlineTrigger();
        return;
      }
      if (event.key === "@" && onAtMention) {
        setInlineTrigger({
          kind: "mention",
          start: event.currentTarget.selectionStart + 1,
          hasTriggerCharacter: true,
        });
        onAtMention("", cursorPosition(event.currentTarget));
      } else if (
        event.key === "/" &&
        onSlashCommand &&
        (event.currentTarget.selectionStart === 0 ||
          /\s/u.test(value.charAt(event.currentTarget.selectionStart - 1)))
      ) {
        setInlineTrigger({
          kind: "slash",
          start: event.currentTarget.selectionStart + 1,
          hasTriggerCharacter: true,
        });
        onSlashCommand("");
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const shortcutFormat =
        event.key.toLowerCase() === "b"
          ? "bold"
          : event.key.toLowerCase() === "i"
            ? "italic"
            : null;
      if (!shortcutFormat) return;
      event.preventDefault();
      applyFormat(shortcutFormat);
    },
    [
      applyFormat,
      closeInlineTrigger,
      inlineTriggerRef,
      onAtMention,
      onKeyDownForDropdown,
      onKeyDownForSlashDropdown,
      onSlashCommand,
      onSubmit,
      setInlineTrigger,
      value,
    ]
  );
}
