/**
 * Button Component (Native Implementation)
 *
 * Two orthogonal axes describe a button's look:
 *
 *   variant  — importance
 *              "primary"   = call to action, filled
 *              "secondary" = regular action, outlined (default)
 *              "tertiary"  = supporting action, transparent with a hover
 *                            background
 *              "ghost"     = inline action, transparent; hover changes only
 *                            the text / icon color
 *
 *   tone     — semantic color on top of the variant
 *              "danger" | "warning" | "success" | "merged"
 *              (hoverTone colors a neutral button only while hovered)
 *
 * A toggle is a tertiary or ghost with `aria-pressed`. `layout="custom"`
 * hands both geometry and surface to the caller.
 *
 * Button's own utilities are emitted in a nested cascade layer (the `btn:`
 * variant), so any class passed through `className` overrides them.
 *
 * @example
 * ```tsx
 * import Button from "@src/components/Button";
 *
 * <Button variant="primary">Submit</Button>
 * <Button size="small">Cancel</Button>
 * <Button variant="primary" tone="danger">Delete</Button>
 * <Button variant="tertiary" tone="danger" iconOnly icon={<Trash />} />
 * <Button variant="tertiary">More</Button>
 * <Button variant="tertiary" aria-pressed={on}>Aa</Button>
 * <Button variant="ghost" size="inline">View all</Button>
 * <Button variant="tertiary" hoverTone="danger" iconOnly icon={<Trash />} />
 * <Button loading>Loading...</Button>
 * ```
 */
import React, { forwardRef } from "react";

import {
  type ButtonHoverTone,
  type ButtonShape,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
  useButtonPresentation,
} from "./presentation";

export type {
  ButtonHoverTone,
  ButtonTone,
  ButtonVariant,
} from "./presentation";

export interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  /**
   * Preserve direct children, CSS-owned geometry and CSS-owned surface for
   * compound controls such as menu rows, switch tracks, tabs and selectable
   * cards: Button draws no size, color or disabled styling. Ordinary actions
   * use the default layout with variant, size, icon and iconOnly props.
   */
  layout?: "default" | "custom";
  /**
   * Importance: primary, secondary, tertiary or ghost. Color comes from `tone`.
   * @default "secondary"
   */
  variant?: ButtonVariant;

  /**
   * Semantic color on top of the variant (see {@link ButtonTone}): filled on a
   * primary, tone text on a secondary outline, tone text with a tinted hover
   * on a tertiary.
   */
  tone?: ButtonTone;

  /**
   * Button size; inline inherits surrounding typography without a fixed height;
   * sidebar is 20px, reserved for compact sidebar/rail rows and headers
   * @default "default"
   */
  size?: ButtonSize;

  /**
   * Button shape
   * @default "square"
   */
  shape?: ButtonShape;

  /** Loading state @default false */
  loading?: boolean;

  /**
   * When true and loading, spin the provided icon in place instead of
   * replacing it with the Loader2 spinner.
   * @default false
   */
  loadingSpinIcon?: boolean;

  /** Disabled state @default false */
  disabled?: boolean;

  /**
   * Icon element (left side by default)
   * Can be a React node or a string (icon class name like "ri-home-line")
   */
  icon?: React.ReactNode | string;

  /** Icon position @default "left" */
  iconPosition?: "left" | "right";

  /** Icon-only button (no text) @default false */
  iconOnly?: boolean;

  /**
   * Color a neutral (secondary / tertiary) button shows only while hovered,
   * pressed or keyboard-focused; it stays neutral at rest. Prefer it to
   * hand-written hover color classes. Semantic variants already carry a color
   * and ignore it.
   */
  hoverTone?: ButtonHoverTone;

  /** Display-only shortcut hint; the caller owns keyboard handling. Hidden for icon-only buttons. */
  shortcut?: string;

  /**
   * Center the label on the button's own center, taking the icon out of flow so
   * it sits beside the centered label instead of shifting it. Intended for
   * full-width buttons — on a hug-width button the icon overhangs the edge.
   * @default false
   */
  centerLabel?: boolean;

  /** Button takes full width @default false */
  long?: boolean;

  /** HTML button type @default "button" */
  htmlType?: "button" | "submit" | "reset";

  /** Button href (renders as anchor) */
  href?: string;

  /** Anchor target */
  target?: string;

  /** Anchor relationship */
  rel?: string;

  /** Children content */
  children?: React.ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      layout = "default",
      variant = "secondary",
      tone,
      size = "default",
      shape = "square",
      loading = false,
      loadingSpinIcon = false,
      disabled = false,
      icon,
      iconPosition = "left",
      iconOnly = false,
      hoverTone,
      shortcut,
      centerLabel = false,
      long = false,
      htmlType = "button",
      href,
      target,
      rel,
      children,
      className = "",
      style,
      onClick,
      ...rest
    },
    ref
  ) => {
    const { isDisabled, buttonStyles, buttonContent, buttonClassName } =
      useButtonPresentation({
        layout,
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
      });

    if (href && !isDisabled) {
      return (
        <a
          href={href}
          target={target}
          rel={rel}
          className={buttonClassName}
          style={buttonStyles}
          onClick={
            onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>
          }
          {...(rest as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {buttonContent}
        </a>
      );
    }

    return (
      <button
        {...rest}
        ref={ref}
        type={htmlType}
        disabled={isDisabled}
        className={buttonClassName}
        style={buttonStyles}
        onClick={onClick}
      >
        {buttonContent}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
