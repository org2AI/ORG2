import React, { useMemo } from "react";

import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
} from "@src/components/KeyboardShortcut";
import { HugeiconsIcon, Loading03Icon } from "@src/icons";

/**
 * Importance, from most to least prominent:
 * - primary: filled call to action
 * - secondary: outlined regular action
 * - tertiary: transparent, gains a background on hover
 * - ghost: transparent, only the text / icon color changes on hover
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost";

/**
 * Semantic color on top of any variant: a primary becomes a filled tone, a
 * secondary a tone-text outline, a tertiary tone text with a tinted hover,
 * a ghost tone text.
 */
export type ButtonTone = "danger" | "warning" | "success" | "merged";
export type ButtonSize =
  | "inline"
  | "sidebar"
  | "mini"
  | "small"
  | "default"
  | "large";
export type ButtonShape = "square" | "round" | "circle";
/** Color a neutral button takes only while hovered, pressed or focused. */
export type ButtonHoverTone = "danger" | "primary";

const BUTTON_SIZE_CONFIG = {
  inline: { height: 20, padding: "0", fontSize: 12, iconSize: 12 },
  sidebar: { height: 20, padding: "0 4px", fontSize: 12, iconSize: 14 },
  mini: { height: 24, padding: "0 8px", fontSize: 12, iconSize: 12 },
  small: { height: 28, padding: "0 12px", fontSize: 13, iconSize: 14 },
  default: { height: 32, padding: "0 14px", fontSize: 13, iconSize: 14 },
  large: { height: 40, padding: "0 18px", fontSize: 14, iconSize: 16 },
} as const;

/**
 * Button's own utilities use the component-default variants from
 * src/tailwind.css: resting styles carry `btn:` (a lower nested layer) and
 * interaction states carry `btn-hover:` / `btn-active:` / `btn-focus:` /
 * `btn-pressed:` (single-class specificity). A caller's `className` therefore
 * overrides them like a later class in one list: resting classes beat resting
 * defaults, and caller state classes beat default states. The cursor follows
 * the app's pointer-cursor preference, like the `.cursor-pointer` override in
 * src/index.scss.
 *
 * Class strings must be statically analyzable: fully written literals,
 * selected or concatenated whole, never assembled from fragments.
 */
const NEUTRAL_HOVER_TEXT = "btn-hover:text-text-1 btn-focus:text-text-1";

/** Text colors a neutral button shows only while hovered, pressed or focused. */
const HOVER_TONE_TEXT = {
  danger:
    "btn-hover:text-danger-6 btn-active:text-danger-6 btn-focus:text-danger-6",
  primary:
    "btn-hover:text-primary-6 btn-active:text-primary-6 btn-focus:text-primary-6",
} as const;

const FOCUS_RING_SHADOW =
  "btn-focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)]";

/** Toggle state shared by the transparent variants (`aria-pressed`). */
const PRESSED = "btn-pressed:bg-surface-selected btn-pressed:text-primary-6";

/**
 * Filled primaries. The fill stops inside a transparent 1px border so its
 * visible body matches the secondary outline's hairline-bordered box.
 */
const PRIMARY_FILL = {
  none: "btn:border btn:border-transparent btn:bg-clip-padding btn:text-white btn:bg-primary-6 btn-hover:bg-primary-5 btn-active:bg-primary-7",
  danger:
    "btn:border-0 btn:text-white btn:bg-danger-6 btn-hover:bg-danger-5 btn-active:bg-danger-6",
  warning:
    "btn:border-0 btn:text-white btn:bg-warning-6 btn-hover:bg-warning-5 btn-active:bg-warning-6",
  success:
    "btn:border-0 btn:text-success-fill-contrast btn:bg-success-fill btn-hover:bg-success-fill-hover btn-active:bg-success-fill-active",
  merged:
    "btn:border-0 btn:bg-merged btn:text-merged-contrast btn-hover:bg-merged-hover btn-active:bg-merged-active",
} as const;

/** Toned secondaries keep the neutral outline and take the tone's text. */
const SECONDARY_TONE_TEXT = {
  danger: "btn:text-danger-6",
  warning: "btn:text-warning-6",
  success: "btn:text-success-6",
  merged: "btn:text-purple-6",
} as const;

/** Toned tertiaries: tone text on a tinted hover surface. */
const TERTIARY_TONE = {
  danger:
    "btn:text-danger-6 btn-hover:bg-danger-2 btn-hover:text-danger-6 btn-focus:bg-danger-2 btn-focus:text-danger-6",
  warning: "btn:text-warning-6 btn-hover:bg-warning-3 btn-focus:bg-warning-3",
  success: "btn:text-success-6 btn-hover:bg-success-3 btn-focus:bg-success-3",
  merged: "btn:text-purple-6 btn-hover:bg-purple-3 btn-focus:bg-purple-3",
} as const;

/** Toned ghosts: tone text that brightens on hover, no surface. */
const GHOST_TONE = {
  danger: "btn:text-danger-6 btn-hover:text-danger-5",
  warning: "btn:text-warning-6 btn-hover:text-warning-5",
  success: "btn:text-success-6 btn-hover:text-success-5",
  merged: "btn:text-purple-6 btn-hover:text-purple-5",
} as const;

/** Default utilities for each (variant, tone) cell, space-normalized. */
function getButtonStyleClasses(
  variant: ButtonVariant,
  tone: ButtonTone | undefined,
  hoverTone: ButtonHoverTone | undefined
) {
  return buttonStyleCell(variant, tone, hoverTone).replace(/\s+/g, " ").trim();
}

function buttonStyleCell(
  variant: ButtonVariant,
  tone: ButtonTone | undefined,
  hoverTone: ButtonHoverTone | undefined
) {
  // Toned buttons already carry their color, so only neutral ones take a
  // hover tone. It replaces the neutral hover text instead of being layered.
  const hoverText =
    !tone && variant !== "primary" && hoverTone
      ? HOVER_TONE_TEXT[hoverTone]
      : NEUTRAL_HOVER_TEXT;
  switch (variant) {
    case "primary":
      return PRIMARY_FILL[tone ?? "none"];
    case "secondary":
      return tone
        ? `btn:border btn:border-border-2 btn:bg-bg-2 ${SECONDARY_TONE_TEXT[tone]}`
        : `btn:border btn:border-border-2 btn:bg-bg-2 btn:text-text-1 btn-hover:border-border-3 btn-focus:border-(--color-primary-6) ${FOCUS_RING_SHADOW} ${hoverTone ? hoverText : ""}`;
    case "tertiary":
      return tone
        ? `btn:border-0 btn:bg-transparent ${TERTIARY_TONE[tone]} ${PRESSED}`
        : `btn:border-0 btn:bg-transparent btn:text-text-2 ${hoverText} btn-hover:bg-surface-hover btn-active:bg-surface-selected ${PRESSED} btn-focus:outline-none ${FOCUS_RING_SHADOW}`;
    case "ghost":
      return tone
        ? `btn:border-0 btn:bg-transparent ${GHOST_TONE[tone]}`
        : `btn:border-0 btn:bg-transparent btn:text-text-2 ${hoverText} btn-pressed:text-primary-6 btn-focus:outline-none ${FOCUS_RING_SHADOW}`;
  }
}

interface ButtonPresentationOptions {
  layout?: "default" | "custom";
  variant: ButtonVariant;
  tone?: ButtonTone;
  size: ButtonSize;
  shape: ButtonShape;
  loading: boolean;
  loadingSpinIcon: boolean;
  disabled: boolean;
  icon?: React.ReactNode | string;
  iconPosition: "left" | "right";
  iconOnly: boolean;
  hoverTone?: ButtonHoverTone;
  shortcut?: string;
  centerLabel: boolean;
  long: boolean;
  children?: React.ReactNode;
  className: string;
  style?: React.CSSProperties;
}

export function useButtonPresentation({
  layout = "default",
  variant,
  tone,
  size,
  shape,
  loading,
  loadingSpinIcon,
  disabled,
  icon,
  iconPosition,
  iconOnly,
  hoverTone,
  shortcut,
  centerLabel,
  long,
  children,
  className,
  style,
}: ButtonPresentationOptions) {
  const sizeConfig = BUTTON_SIZE_CONFIG[size];
  const isDisabled = disabled || loading;

  const borderRadius = useMemo(() => {
    if (shape === "circle") return "50%";
    if (shape === "round") return "100px";
    return size === "sidebar" ? "var(--radius-sm)" : "8px";
  }, [shape, size]);

  const buttonStyles = useMemo<React.CSSProperties>(() => {
    if (layout === "custom") return style ?? {};
    const iconOnlySize =
      iconOnly || shape === "circle" ? sizeConfig.height : undefined;
    return {
      height: size === "inline" && !iconOnly ? "auto" : sizeConfig.height,
      padding: iconOnly || shape === "circle" ? "0" : sizeConfig.padding,
      width: long ? "100%" : iconOnlySize,
      minWidth: long ? 0 : undefined,
      fontSize: size === "inline" ? undefined : sizeConfig.fontSize,
      borderRadius,
      ...style,
    };
  }, [layout, size, sizeConfig, iconOnly, shape, long, borderRadius, style]);

  // Icon↔label spacing lives on the icon itself (margin), NOT on a flex
  // `gap` of the <button>: WebKit's button-internal (anonymous-box) layout
  // can drop the gap, which rendered the loading spinner flush against /
  // overlapping the label (e.g. the "Verify setup" button while verifying).
  const iconSpacingClass =
    children && !iconOnly ? (iconPosition === "right" ? "ml-2" : "mr-2") : "";

  const renderIcon = () => {
    if (loading) {
      if (loadingSpinIcon && icon) {
        return (
          <span
            className={`pointer-events-none inline-flex shrink-0 animate-spin items-center justify-center leading-none ${iconSpacingClass}`}
          >
            {icon}
          </span>
        );
      }
      return (
        <span
          className={`pointer-events-none inline-flex shrink-0 items-center justify-center leading-none ${iconSpacingClass}`}
        >
          <HugeiconsIcon
            icon={Loading03Icon}
            data-icon="loader-2"
            size={sizeConfig.iconSize}
            className="animate-spin"
          />
        </span>
      );
    }
    if (icon) {
      if (typeof icon === "string") {
        return (
          <i
            className={`${icon} inline-flex shrink-0 items-center justify-center leading-none ${iconSpacingClass}`}
            style={{ fontSize: sizeConfig.iconSize }}
          />
        );
      }
      return (
        <span
          className={`pointer-events-none inline-flex shrink-0 items-center justify-center leading-none ${iconSpacingClass}`}
        >
          {icon}
        </span>
      );
    }
    return null;
  };

  const iconNode = renderIcon();
  const label = iconOnly ? null : (
    <span className="min-w-0 truncate leading-tight">{children}</span>
  );

  // `centerLabel` pulls the icon out of flow so the label alone sits on the
  // button's horizontal center. Centering icon + label as one group leaves the
  // label reading off-center, which is visible on full-width action buttons.
  const buttonContent =
    layout === "custom" ? (
      <>
        {iconPosition === "left" && iconNode}
        {children}
        {iconPosition === "right" && iconNode}
      </>
    ) : centerLabel && label && iconNode ? (
      <span className="relative inline-flex min-w-0 items-center justify-center">
        <span
          className={`absolute inset-y-0 inline-flex items-center ${
            iconPosition === "right" ? "left-full" : "right-full"
          }`}
        >
          {iconNode}
        </span>
        {label}
      </span>
    ) : (
      <>
        {iconPosition === "left" && iconNode}
        {label}
        {iconPosition === "right" && iconNode}
      </>
    );

  const baseClasses =
    layout === "custom"
      ? ""
      : "btn:inline-flex btn:items-center btn:justify-center btn:font-medium btn:whitespace-nowrap btn:select-none btn:no-underline btn:outline-none btn:transition-[border-color,box-shadow,background-color,color,opacity] btn:duration-150";
  const disabledClasses = isDisabled
    ? "btn:cursor-not-allowed btn:opacity-50"
    : "btn:cursor-[var(--interactive-cursor,default)]";
  const buttonClassName = [
    layout === "custom" ? "" : "button",
    baseClasses,
    layout === "custom" ? "" : disabledClasses,
    // A custom layout owns its surface too; Button draws no colors for it.
    layout === "custom" ? "" : getButtonStyleClasses(variant, tone, hoverTone),
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    sizeConfig,
    isDisabled,
    borderRadius,
    buttonStyles,
    buttonContent:
      shortcut?.trim() && !iconOnly ? (
        <>
          {buttonContent}
          <span
            aria-hidden="true"
            className="pointer-events-none ml-2 inline-flex shrink-0"
          >
            <KeyboardShortcut
              shortcut={shortcut}
              variant={KEYBOARD_SHORTCUT_VARIANT.inline}
            />
          </span>
        </>
      ) : (
        buttonContent
      ),
    buttonClassName,
  };
}
