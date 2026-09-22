/**
 * Native Input Component
 *
 * Text input component with native implementation.
 *
 * Features:
 * - Full API compatibility
 * - Text, password, search variants
 * - Multiple sizes
 * - Prefix/suffix support
 * - Clear button
 * - Inline confirm (check) / cancel (x) actions for edit-in-place fields
 * - Error states with optional single-line message
 *
 * @example
 * ```tsx
 * import Input from "@src/components/Input";
 *
 * <Input placeholder="Enter text" />
 * <Input type="password" size="large" />
 * <Input prefix={<Search size={16} />} />
 * <Input errorMessage="Name already exists" />
 * <Input errorMessage="Name already exists" errorPlacement="left" />
 * <Input value={draft} onChange={setDraft} onConfirm={save} onCancel={close} />
 * <Input value={draft} savedValue={name} onConfirm={save} onCancel={reset} />
 * ```
 */
import React, { forwardRef, useCallback, useState } from "react";

import Button from "@src/components/Button";
import type { FieldAppearance } from "@src/components/controlAppearance";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { Cancel01Icon, HugeiconsIcon, ViewIcon, ViewOffIcon } from "@src/icons";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { InputEditActions } from "./InputEditActions";
import "./index.scss";

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "size" | "prefix"
> {
  /**
   * Input value (controlled)
   */
  value?: string;

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: string;

  /**
   * Change handler (receives string directly)
   */
  onChange?: (value: string, e: React.ChangeEvent<HTMLInputElement>) => void;

  /**
   * Input size
   * @default 'default'
   */
  size?: "mini" | "small" | "default" | "large";

  /**
   * Corner treatment. `round` is a pill, matching `<Button shape="round">`.
   * @default 'square'
   */
  shape?: "square" | "round";

  /**
   * Input status/error state
   */
  error?: boolean;

  /**
   * Single-line error message rendered next to the input. When set, the input
   * is also styled as errored — no separate `error` flag needed.
   */
  errorMessage?: string;

  /**
   * Where the `errorMessage` sits relative to the input.
   * @default 'bottom'
   */
  errorPlacement?: "bottom" | "left";

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Readonly state
   */
  readOnly?: boolean;

  /**
   * Allow clear button
   */
  allowClear?: boolean;

  /**
   * Called when the clear button is clicked. When provided, the default
   * synthetic `onChange("")` is skipped so callers can fully own clear behavior
   * (e.g. reset related state in one place).
   */
  onClear?: () => void;

  /**
   * Shows a tertiary icon-only check button at the end of the field and makes
   * Enter call it. Receives the current value, so uncontrolled fields need no
   * ref to read it.
   */
  onConfirm?: (value: string) => void;

  /**
   * Shows a tertiary icon-only x button at the end of the field and makes
   * Escape call it.
   */
  onCancel?: () => void;

  /**
   * The persisted value this field edits. When set, the check / x actions and
   * their Enter / Escape bindings appear only while the current value differs
   * from it, so an always-editable field stays clean until the user edits it.
   * Omit it for explicit edit modes where the actions should always show.
   */
  savedValue?: string;

  /** Disables the check button and its Enter binding. */
  confirmDisabled?: boolean;

  /**
   * Shows a spinner on the check button while a confirm is in flight. Both
   * actions are disabled until it clears.
   */
  confirmLoading?: boolean;

  /**
   * Accessible label and tooltip for the check button.
   * @default "Save"
   */
  confirmLabel?: string;

  /**
   * Accessible label and tooltip for the x button.
   * @default "Cancel"
   */
  cancelLabel?: string;

  /**
   * Prefix element (icon, text, etc.)
   */
  prefix?: React.ReactNode;

  /**
   * Suffix element (icon, text, etc.)
   */
  suffix?: React.ReactNode;

  /**
   * Max length
   */
  maxLength?: number;

  /**
   * Show word count
   */
  showWordLimit?: boolean;

  /**
   * Input type
   * @default 'text'
   */
  type?:
    | "text"
    | "password"
    | "email"
    | "number"
    | "tel"
    | "url"
    | "search"
    | "time"
    | "date"
    | "datetime-local";

  /**
   * Show password visibility toggle (for password type)
   * @default true
   */
  visibilityToggle?: boolean;

  /**
   * Visual field treatment.
   *
   * `ghost` is transparent at rest and uses the shared interactive surface
   * while hovered or focused. `bare` stays permanently chromeless.
   * @default 'default'
   */
  appearance?: FieldAppearance;

  /**
   * Let content determine height instead of using the preset size height.
   */
  autoHeight?: boolean;

  /**
   * Additional class name for input element
   */
  inputClassName?: string;

  /**
   * Additional style for input element
   */
  inputStyle?: React.CSSProperties;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      value,
      defaultValue,
      onChange,
      size = "default",
      shape = "square",
      error = false,
      errorMessage,
      errorPlacement = "bottom",
      disabled = false,
      readOnly = false,
      allowClear = false,
      onClear,
      onConfirm,
      onCancel,
      savedValue,
      confirmDisabled = false,
      confirmLoading = false,
      confirmLabel,
      cancelLabel,
      prefix,
      suffix,
      maxLength,
      showWordLimit = false,
      type = "text",
      visibilityToggle = true,
      appearance = "default",
      autoHeight = false,
      className = "",
      style,
      inputClassName = "",
      inputStyle,
      placeholder,
      onFocus,
      onBlur,
      onKeyDown,
      ...rest
    },
    ref
  ) => {
    const { isDark } = useCurrentTheme();
    const [internalValue, setInternalValue] = useState(defaultValue || "");
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const isControlled = value !== undefined;
    const currentValue = isControlled ? value : internalValue;

    const hasError = error || !!errorMessage;
    const isChromeless = appearance !== "default";
    const hasEditActions =
      (!!onConfirm || !!onCancel) &&
      (savedValue === undefined || currentValue !== savedValue);
    const confirmBlocked = disabled || confirmDisabled || confirmLoading;
    const cancelBlocked = disabled || confirmLoading;

    const wrapperClasses = [
      "input-wrapper",
      `input-size-${size}`,
      shape === "round" && "input-shape-round",
      hasError && "input-error",
      disabled && "input-disabled",
      isFocused && "input-focused",
      readOnly && "input-readonly",
      appearance === "bare" && "input-field-bare",
      autoHeight && "input-auto-height",
      appearance === "ghost" && "input-field-ghost",
      hasEditActions && "input-has-edit-actions",
      isDark && "input-dark",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const inputClasses = ["input", inputClassName].filter(Boolean).join(" ");
    // The border and focus ring are drawn on `.input-inner`, so its radius is
    // the field's shape.
    const inputInnerClassName = isChromeless
      ? "input-inner"
      : `input-inner ${shape === "round" ? "rounded-full" : "rounded-lg"} bg-bg-2`;

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;

        if (!isControlled) {
          setInternalValue(newValue);
        }

        onChange?.(newValue, e);
      },
      [isControlled, onChange]
    );

    const handleClear = useCallback(() => {
      if (onClear) {
        onClear();
        if (!isControlled) {
          setInternalValue("");
        }
        return;
      }

      const syntheticEvent = {
        target: { value: "" },
        currentTarget: { value: "" },
      } as React.ChangeEvent<HTMLInputElement>;

      if (!isControlled) {
        setInternalValue("");
      }

      onChange?.("", syntheticEvent);
    }, [isControlled, onChange, onClear]);

    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus]
    );

    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur]
    );

    const tauriSelectAll = useTauriSelectAllShortcut();

    const handleConfirm = useCallback(() => {
      onConfirm?.(currentValue);
    }, [currentValue, onConfirm]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(event);
        tauriSelectAll(event);
        if (
          !hasEditActions ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        ) {
          return;
        }
        if (event.key === "Enter" && onConfirm) {
          event.preventDefault();
          if (!confirmBlocked) onConfirm(currentValue);
        } else if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          if (!cancelBlocked) onCancel();
        }
      },
      [
        cancelBlocked,
        confirmBlocked,
        currentValue,
        hasEditActions,
        onCancel,
        onConfirm,
        onKeyDown,
        tauriSelectAll,
      ]
    );

    const togglePasswordVisibility = useCallback(() => {
      setShowPassword((prev) => !prev);
    }, []);

    const showClearButton =
      allowClear && currentValue && !disabled && !readOnly;
    const showPasswordToggle = type === "password" && visibilityToggle;
    const inputType =
      type === "password" ? (showPassword ? "text" : "password") : type;

    // For bottom placement the width style applies to the whole field so the
    // message wraps under a sized input. For left placement the style stays on
    // the input wrapper so the input keeps its width and the message is extra.
    const wrapperStyle =
      errorMessage && errorPlacement === "bottom" ? undefined : style;

    const inputWrapper = (
      <div className={wrapperClasses} style={wrapperStyle}>
        <div className={inputInnerClassName}>
          {prefix && <span className="input-prefix">{prefix}</span>}

          <input
            ref={ref}
            type={inputType}
            value={currentValue}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            maxLength={maxLength}
            className={inputClasses}
            style={inputStyle}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            {...rest}
          />

          {showClearButton && (
            <Button
              layout="custom"
              className="input-clear"
              onClick={handleClear}
              tabIndex={-1}
            >
              <HugeiconsIcon icon={Cancel01Icon} data-icon="x" size={16} />
            </Button>
          )}

          {showPasswordToggle && (
            <Button
              layout="custom"
              className="input-password-toggle"
              onClick={togglePasswordVisibility}
              tabIndex={-1}
            >
              {showPassword ? (
                <HugeiconsIcon
                  icon={ViewOffIcon}
                  data-icon="eye-off"
                  size={16}
                />
              ) : (
                <HugeiconsIcon icon={ViewIcon} data-icon="eye" size={16} />
              )}
            </Button>
          )}

          {suffix && <span className="input-suffix">{suffix}</span>}

          {showWordLimit && maxLength && (
            <span className="input-word-limit">
              {currentValue?.length || 0}/{maxLength}
            </span>
          )}

          {hasEditActions && (
            <InputEditActions
              size={size}
              onConfirm={onConfirm ? handleConfirm : undefined}
              onCancel={onCancel}
              confirmDisabled={confirmBlocked}
              confirmLoading={confirmLoading}
              cancelDisabled={cancelBlocked}
              confirmLabel={confirmLabel}
              cancelLabel={cancelLabel}
            />
          )}
        </div>
      </div>
    );

    if (!errorMessage) return inputWrapper;

    return (
      <div
        className={`input-field input-field-${errorPlacement}`}
        style={errorPlacement === "bottom" ? style : undefined}
      >
        {errorPlacement === "left" && (
          <span className="input-error-message">{errorMessage}</span>
        )}
        {inputWrapper}
        {errorPlacement === "bottom" && (
          <span className="input-error-message">{errorMessage}</span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
