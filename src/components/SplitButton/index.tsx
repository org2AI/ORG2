import React, { forwardRef } from "react";

import Button from "@src/components/Button";
import type {
  ButtonProps,
  ButtonTone,
  ButtonVariant,
} from "@src/components/Button";
import { useButtonPresentation } from "@src/components/Button/presentation";
import { ArrowDown01Icon, HugeiconsIcon } from "@src/icons";

interface SplitButtonProps extends Omit<
  ButtonProps,
  "href" | "target" | "rel" | "aria-expanded" | "aria-haspopup"
> {
  /** Menu anchor or portal rendered while the menu is open. */
  menu: React.ReactNode;

  /** Controlled menu visibility. */
  menuOpen: boolean;

  /** Activates the menu segment. */
  onMenuButtonClick: React.MouseEventHandler<HTMLButtonElement>;

  /** Accessible name for the menu segment. */
  menuButtonLabel: string;

  /** Optional main-segment width for icon-only split buttons. */
  mainSegmentWidth?: number;

  /**
   * Optional menu-segment width in pixels. Defaults to half the button height
   * for icon-only buttons and the full button height otherwise.
   */
  menuSegmentWidth?: number;

  /** Centers content within the main segment or the whole split control. */
  contentAlignment?: "main" | "whole";

  /** Whether a labelled split button fills its parent or hugs its content. */
  widthMode?: "fill" | "hug";
}

/**
 * The surface each variant draws, in the terms the split coloring below was
 * written for: a primary is filled, a secondary outlined, a tertiary the
 * transparent no-drop surface (a toned tertiary the tinted soft one), and a
 * ghost stays transparent.
 */
type SplitSurface = "solid" | "outline" | "soft" | "soft-no-drop" | "ghost";

function splitSurface(
  variant: ButtonVariant,
  tone: ButtonTone | undefined
): SplitSurface {
  switch (variant) {
    case "primary":
      return "solid";
    case "secondary":
      return "outline";
    case "tertiary":
      return tone ? "soft" : "soft-no-drop";
    case "ghost":
      return "ghost";
  }
}

const SplitButton = forwardRef<HTMLButtonElement, SplitButtonProps>(
  (
    {
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
      centerLabel = false,
      long = false,
      htmlType = "button",
      children,
      className = "",
      style,
      onClick,
      menu,
      menuOpen,
      onMenuButtonClick,
      menuButtonLabel,
      mainSegmentWidth,
      menuSegmentWidth,
      contentAlignment = "main",
      widthMode = "fill",
      ...rest
    },
    ref
  ) => {
    const {
      sizeConfig,
      isDisabled,
      borderRadius,
      buttonStyles,
      buttonContent,
      buttonClassName,
    } = useButtonPresentation({
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
      centerLabel,
      long,
      children,
      className,
      style,
    });

    const resolvedAppearance = splitSurface(variant, tone);
    // The menu segment mirrors the main segment's color: its tone when set,
    // otherwise the variant.
    const colorKey = tone ?? variant;

    const highlightOpenMenu =
      menuOpen &&
      !isDisabled &&
      resolvedAppearance === "soft-no-drop" &&
      (variant === "tertiary" || variant === "secondary");
    const mainOpenClass = highlightOpenMenu
      ? "bg-button-hover-no-drop! text-primary-6!"
      : "";

    const wrapperHoverClass = isDisabled
      ? ""
      : resolvedAppearance === "soft-no-drop"
        ? "group-hover/button-split:bg-button-hover-no-drop group-hover/button-split:text-text-1"
        : variant === "tertiary" && resolvedAppearance === "solid"
          ? "group-hover/button-split:bg-surface-hover group-hover/button-split:text-text-1"
          : "";

    const menuColorClass = (() => {
      if (highlightOpenMenu) return "text-primary-6";
      if (resolvedAppearance === "solid") {
        switch (colorKey) {
          case "primary":
          case "danger":
          case "warning":
          case "success":
            return "text-white";
          case "merged":
            return "text-merged-contrast";
          case "secondary":
            return "text-text-1";
          case "tertiary":
          case "ghost":
            return "text-text-2 group-hover/button-split:text-text-1";
        }
      }
      switch (colorKey) {
        case "primary":
          return "text-primary-6";
        case "danger":
          return "text-danger-6";
        case "warning":
          return "text-warning-6";
        case "success":
          return "text-success-6";
        case "merged":
          return "text-purple-6";
        case "secondary":
          return "text-text-1";
        case "tertiary":
        case "ghost":
          return "text-text-2 group-hover/button-split:text-text-1";
      }
    })();

    const menuStateClass = (() => {
      if (isDisabled) return "";
      if (resolvedAppearance === "soft-no-drop") {
        return highlightOpenMenu
          ? "bg-button-hover enabled:hover:bg-button-hover focus-visible:bg-button-hover"
          : "enabled:hover:bg-button-hover focus-visible:bg-button-hover";
      }
      if (resolvedAppearance === "solid") {
        switch (colorKey) {
          case "primary":
            return menuOpen
              ? "bg-primary-5 enabled:hover:bg-primary-5"
              : "enabled:hover:bg-primary-5";
          case "danger":
            return menuOpen
              ? "bg-danger-5 enabled:hover:bg-danger-5"
              : "enabled:hover:bg-danger-5";
          case "warning":
            return menuOpen
              ? "bg-warning-5 enabled:hover:bg-warning-5"
              : "enabled:hover:bg-warning-5";
          case "success":
            return menuOpen
              ? "bg-success-fill-hover enabled:hover:bg-success-fill-hover"
              : "enabled:hover:bg-success-fill-hover";
          case "merged":
            return menuOpen
              ? "bg-merged-hover enabled:hover:bg-merged-hover"
              : "enabled:hover:bg-merged-hover";
          case "secondary":
          case "tertiary":
          case "ghost":
            break;
        }
      }
      return "enabled:hover:bg-fill-3";
    })();

    const resolvedMenuWidth =
      menuSegmentWidth ??
      (iconOnly ? sizeConfig.height / 2 : sizeConfig.height);
    const resolvedMainWidth = iconOnly
      ? (mainSegmentWidth ?? sizeConfig.height)
      : undefined;
    const splitButtonWidth = iconOnly
      ? (resolvedMainWidth ?? sizeConfig.height) + resolvedMenuWidth
      : undefined;
    const shouldHug = widthMode === "hug" && !iconOnly && !long;

    return (
      <div
        className="button-split-wrapper group/button-split"
        style={{
          display: "flex",
          position: "relative",
          width: long ? "100%" : "auto",
          minWidth: 0,
        }}
      >
        <div
          style={{
            position: "relative",
            flex: shouldHug ? "none" : 1,
            display: "flex",
            minWidth: 0,
          }}
        >
          <Button
            layout="custom"
            ref={ref}
            htmlType={htmlType}
            disabled={isDisabled}
            className={`${buttonClassName} ${wrapperHoverClass} ${mainOpenClass}`.trim()}
            style={{
              ...buttonStyles,
              width: shouldHug ? "auto" : (splitButtonWidth ?? "100%"),
              minWidth: 0,
              flex: iconOnly || shouldHug ? "none" : 1,
              paddingRight: iconOnly ? 0 : `${resolvedMenuWidth}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
            onClick={onClick}
            {...rest}
          >
            {shouldHug ? (
              buttonContent
            ) : (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: contentAlignment === "whole" ? 0 : resolvedMenuWidth,
                  top: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                {buttonContent}
              </div>
            )}
          </Button>

          <Button
            layout="custom"
            disabled={isDisabled}
            aria-label={menuButtonLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`transition-colors ${menuStateClass} ${menuColorClass}`}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: resolvedMenuWidth,
              height: "100%",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderTopRightRadius: borderRadius,
              borderBottomRightRadius: borderRadius,
              cursor: isDisabled
                ? "not-allowed"
                : "var(--interactive-cursor, default)",
              opacity: isDisabled ? 0.5 : 1,
            }}
            onClick={onMenuButtonClick}
          >
            <span
              aria-hidden
              data-split-divider
              className="pointer-events-none absolute top-1/4 bottom-1/4 left-0 w-[0.5px] bg-border-1"
            />
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              data-icon="chevron-down"
              size={12}
              aria-hidden
            />
          </Button>
        </div>

        {menuOpen && menu}
      </div>
    );
  }
);

SplitButton.displayName = "SplitButton";

export default SplitButton;
