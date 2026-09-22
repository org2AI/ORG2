/**
 * ReplaceInput Component
 *
 * VSCode-style replace input with action buttons.
 * Supports two variants matching SearchInput:
 * - "panel": For in-editor search (with border, larger)
 * - "sidebar": For sidebar search (borderless, minimal style)
 *
 * Shared Input uses searchControlSingleLineInputStyle (line-height = row height).
 *
 * [Replace icon] [input] [replace] [replace all]
 */
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import type {
  SearchInputSurface,
  SearchInputVariant,
} from "@src/components/SearchInput";
import {
  SEARCH_ROW_TOP_OFFSET_PX,
  SEARCH_WRAPPER_PANEL,
  SEARCH_WRAPPER_PANE_INPUT,
  SEARCH_WRAPPER_SIDEBAR,
  searchControlMultilineInputStyle,
  searchControlSingleLineInputStyle,
  searchWrapperMultiline,
} from "@src/components/SearchInput/searchControlInputStyles";
import Textarea from "@src/components/Textarea";
import { HEADER_BUTTON } from "@src/config/workstation/tokens";
import { HugeiconsIcon, ReplaceAllIcon, ReplaceIcon } from "@src/icons";

// ============================================
// Types
// ============================================

export interface ReplaceInputProps {
  /** Current replace value */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Visual variant: "panel" (editor search) or "sidebar" (global search) */
  variant?: SearchInputVariant;
  /** Background surface token for the input box. */
  surface?: SearchInputSurface;
  /** Callback for replace single (optional - for in-file search) */
  onReplace?: () => void;
  /** Callback for replace all */
  onReplaceAll?: () => void;
  /** Whether buttons are disabled */
  disabled?: boolean;
  /** Input ref - supports both input and textarea */
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Custom class name */
  className?: string;
  /** Enable multiline input (uses textarea instead of input) */
  multiline?: boolean;
  /** Hide the spacer (for external layout control where chevron is separate) */
  hideSpacer?: boolean;
  /** Callback when Enter is pressed (prevents newline insertion in multiline mode) */
  onSubmit?: () => void;
  /** Extra class name applied to the input box itself (not the outer container) */
  inputBoxClassName?: string;
}

// ============================================
// Component
// ============================================

export const ReplaceInput: React.FC<ReplaceInputProps> = memo(
  ({
    value,
    onChange,
    placeholder = "Replace",
    variant = "panel",
    surface = "default",
    onReplace,
    onReplaceAll,
    disabled = false,
    inputRef,
    className = "",
    multiline = false,
    hideSpacer = false,
    onSubmit,
    inputBoxClassName = "",
  }) => {
    const { t } = useTranslation();

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmit?.();
        }
      },
      [onSubmit]
    );

    const handleTextareaResize = useCallback(
      (textarea: HTMLTextAreaElement | null) => {
        if (textarea) {
          textarea.style.height = "auto";
          textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
        }
      },
      []
    );

    React.useEffect(() => {
      if (multiline && inputRef?.current instanceof HTMLTextAreaElement) {
        handleTextareaResize(inputRef.current);
      }
    }, [value, multiline, inputRef, handleTextareaResize]);

    const isSidebar = variant === "sidebar";

    // In multiline mode, top-align the row (spacer / input box / action buttons)
    // instead of centering it — otherwise the action buttons re-center into the
    // middle of the box as the textarea grows past one line. The matching
    // top-offset margin below keeps them at the single-line centered position.
    const containerClass = isSidebar
      ? `flex ${multiline ? "items-start" : "items-center"} gap-2.5`
      : `flex ${multiline ? "items-start" : "items-center"} gap-3`;
    const actionButtonStyle = multiline
      ? { marginTop: SEARCH_ROW_TOP_OFFSET_PX }
      : undefined;

    const inputWrapperClass = isSidebar
      ? SEARCH_WRAPPER_SIDEBAR
      : SEARCH_WRAPPER_PANEL;
    const inputWrapperSurfaceClass =
      surface === "pane"
        ? `${inputWrapperClass} ${SEARCH_WRAPPER_PANE_INPUT}`
        : inputWrapperClass;
    const inputWrapperMultilineClass = multiline
      ? searchWrapperMultiline(inputWrapperSurfaceClass)
      : inputWrapperSurfaceClass;

    const actionButtonClass = `${HEADER_BUTTON.action} disabled:cursor-not-allowed disabled:opacity-50`;

    const spacerWidth = isSidebar ? "w-[17px]" : "w-[22px]";
    const iconSize = 14;

    return (
      <div className={`${containerClass} ${className}`}>
        {!hideSpacer && <div className={spacerWidth} />}

        <div className={`${inputWrapperMultilineClass} ${inputBoxClassName}`}>
          {multiline ? (
            <Textarea
              appearance="bare"
              size="small"
              resize="none"
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(value) => onChange(value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              textareaStyle={searchControlMultilineInputStyle(14)}
              className="min-w-0 flex-1"
              textareaClassName="text-text-1 placeholder:text-text-3"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              rows={1}
              onInput={(event) =>
                handleTextareaResize(event.target as HTMLTextAreaElement)
              }
            />
          ) : (
            <Input
              autoHeight
              appearance="bare"
              size="small"
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={(value) => onChange(value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              inputStyle={searchControlSingleLineInputStyle(14)}
              className="min-w-0 flex-1 [&>.input-inner]:border-0!"
              inputClassName="text-text-1 placeholder:text-text-3"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          )}
        </div>

        {onReplace && (
          <Button
            variant="tertiary"
            size="sidebar"
            aria-label={t("tooltips.replace")}
            iconOnly
            icon={
              <HugeiconsIcon
                icon={ReplaceIcon}
                data-icon="replace"
                size={iconSize}
              />
            }
            onClick={onReplace}
            disabled={disabled}
            className={actionButtonClass}
            style={actionButtonStyle}
            title={t("tooltips.replace")}
          />
        )}
        {onReplaceAll && (
          <Button
            variant="tertiary"
            size="sidebar"
            aria-label={t("tooltips.replaceAll")}
            iconOnly
            icon={
              <HugeiconsIcon
                icon={ReplaceAllIcon}
                data-icon="replace-all"
                size={iconSize}
              />
            }
            onClick={onReplaceAll}
            disabled={disabled}
            className={actionButtonClass}
            style={actionButtonStyle}
            title={t("tooltips.replaceAll")}
          />
        )}
      </div>
    );
  }
);

ReplaceInput.displayName = "ReplaceInput";

export default ReplaceInput;
