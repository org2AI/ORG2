/**
 * ComposerShell
 *
 * Shared outer shell for all composer/input surfaces (chat panel, session
 * creator, edit mode).  Owns the border, border-radius, padding, background,
 * edge shadow, and focus-within ring without duplicating
 * token references.
 *
 * Variants
 * --------
 * • "default"  — session creator, standalone (bg-chat-input)
 * • "embedded" — chat panel embedded in conversation (bg-chat-input)
 * • "pill"     — compact single-row chat composer (compact-input preference)
 * • "comment"  — compact avatar-adjacent comment input
 * • "edit"     — queued-message edit box (label strip + inner editor card)
 * • "historyEdit" — sent-message edit box (single layer, same token as normal input)
 */
import React, { forwardRef } from "react";

import { placeCaretAtEnd } from "@src/components/ComposerInput/selection";
import { INPUT_AREA } from "@src/config/inputAreaTokens";

type ComposerShellVariant =
  | "default"
  | "embedded"
  | "pill"
  | "comment"
  | "edit"
  | "historyEdit";

export interface ComposerShellProps {
  variant?: ComposerShellVariant;
  /** Extra className forwarded to the shell div */
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** Forwarded event handlers */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDropCapture?: React.DragEventHandler<HTMLDivElement>;
  /** data-* / aria-* passthrough */
  [key: `data-${string}`]: unknown;
}

// The shell's only transition declaration. Padding and radius ease together
// so the compact pill and the stacked box morph into each other instead of
// snapping corners; the interaction tokens deliberately carry no transition
// of their own, which would compete for `transition-property`.
const SHELL_TRANSITION_CLASSES =
  "transition-[padding,border-radius] duration-300 ease-out motion-reduce:transition-none";

const VARIANT_CLASSES: Record<ComposerShellVariant, string> = {
  default: `composer-surface-shadow ${INPUT_AREA.borderRadiusClass} px-1.5 pt-2.5 pb-1.5 gap-2`,
  embedded: `composer-surface-shadow ${INPUT_AREA.borderRadiusClass} px-1.5 pt-2.5 pb-1.5 gap-2`,
  pill: `composer-surface-shadow ${INPUT_AREA.borderRadiusPillClass} p-1.5 gap-2`,
  comment: `composer-surface-shadow ${INPUT_AREA.borderRadiusClass} px-1.5 py-1.5 gap-1.5`,
  // `edit` is the OUTER label strip — the inner editor card is rendered as
  // a separately-styled child (see `InputArea`). The strip itself is just
  // a padded container that hosts the label row + the inner card.
  edit: `${INPUT_AREA.borderRadiusEditClass} p-1.5 gap-1.5`,
  historyEdit: `${INPUT_AREA.borderRadiusClass} px-1.5 pt-2.5 pb-1.5 gap-2`,
};

const VARIANT_BG_CLASS: Record<ComposerShellVariant, string> = {
  default: INPUT_AREA.backgroundDefaultClass,
  embedded: INPUT_AREA.backgroundChatPanelClass,
  pill: INPUT_AREA.backgroundChatPanelClass,
  comment: INPUT_AREA.backgroundChatPanelClass,
  // The outer edit strip sits on `bg-fill-2` so it reads as a distinct card
  // that wraps the header row + inner editor card (`bg-fill-1`).
  edit: "bg-fill-2",
  historyEdit: INPUT_AREA.backgroundChatPanelClass,
};

// The `edit` variant outer strip has a static border (no hover/focus ring —
// those belong to the INNER editor card). This makes the whole edit surface
// read as a single card rather than two unrelated floating elements.
const VARIANT_INTERACTION_CLASSES: Record<ComposerShellVariant, string> = {
  default: INPUT_AREA.shellInteractionClasses,
  embedded: INPUT_AREA.shellInteractionClasses,
  pill: INPUT_AREA.shellInteractionClasses,
  comment: INPUT_AREA.shellInteractionClasses,
  edit: INPUT_AREA.borderClass,
  historyEdit: INPUT_AREA.shellEditInteractionClasses,
};

function focusComposerFromBackground(event: React.MouseEvent<HTMLDivElement>) {
  const shell = event.currentTarget;
  const target = event.target;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    !(target instanceof Element) ||
    !shell.contains(target)
  ) {
    return;
  }
  const control = target.closest(
    "button, a, input, textarea, select, label, summary, [role], [tabindex], [contenteditable]"
  );
  if (control && shell.contains(control)) return;

  // Only fill the gaps around ComposerInput; clicks inside the editor retain
  // native caret placement, and portaled controls must not steal focus back.
  const editor = shell.querySelector<HTMLElement>(
    '.composer-input-content[contenteditable="true"]'
  );
  if (!editor) return;
  editor.focus({ preventScroll: true });
  // A bare focus() drops the caret at the very start of the text, in front of
  // everything already typed. A click beside the editor means "keep writing",
  // so put it at the end, the way focusing the composer does everywhere else.
  placeCaretAtEnd(editor);
}

const ComposerShell = forwardRef<HTMLDivElement, ComposerShellProps>(
  (
    {
      variant = "default",
      className = "",
      style,
      children,
      onKeyDown,
      onDragOver,
      onDragLeave,
      onDrop,
      onDropCapture,
      ...dataProps
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        data-composer-focus-scope
        className={`relative flex w-full ${variant === "comment" ? "flex-row items-end" : "flex-col"} ${SHELL_TRANSITION_CLASSES} ${VARIANT_INTERACTION_CLASSES[variant]} ${VARIANT_CLASSES[variant]} ${VARIANT_BG_CLASS[variant]} ${className}`}
        style={style}
        onClick={focusComposerFromBackground}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDropCapture={onDropCapture}
        {...dataProps}
      >
        {children}
      </div>
    );
  }
);

ComposerShell.displayName = "ComposerShell";

export default ComposerShell;
