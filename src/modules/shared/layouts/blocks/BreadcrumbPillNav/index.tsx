/**
 * BreadcrumbPillNav
 *
 * Breadcrumb select triggers (tab-pill geometry: h-[28px], rounded-[100px]).
 * Use BreadcrumbPillNavTrigger
 * for transparent ghost select triggers with consistent open state styling.
 */
import React, { forwardRef } from "react";

import { ArrowDown01Icon, HugeiconsIcon } from "@src/icons";
import { classNames } from "@src/util/ui/classNames";

// ============================================
// Tokens
// ============================================

const BREADCRUMB_PILL_NAV_TOKENS = {
  triggerBase:
    "inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-[100px] px-1 text-[13px] transition-colors",
} as const;

// ============================================
// Ghost select trigger (matches TabPill segment height)
// ============================================

interface BreadcrumbPillNavTriggerProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  /** When true, keeps the trigger's open-state styling. */
  isOpen: boolean;
  /** primary = page title weight; secondary = muted until hover/open */
  variant?: "primary" | "secondary";
  children: React.ReactNode;
}

export const BreadcrumbPillNavTrigger = forwardRef<
  HTMLButtonElement,
  BreadcrumbPillNavTriggerProps
>(
  (
    { isOpen, variant = "primary", children, className, disabled, ...rest },
    ref
  ) => {
    const textClass = isOpen
      ? "font-medium text-primary-6"
      : variant === "primary"
        ? "font-medium text-text-1 hover:text-text-2"
        : "text-text-2";
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={classNames(
          BREADCRUMB_PILL_NAV_TOKENS.triggerBase,
          "bg-transparent",
          textClass,
          className
        )}
        {...rest}
      >
        {children}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          data-icon="chevron-down"
          size={12}
          strokeWidth={2.25}
          className={classNames(
            "shrink-0 transition-transform",
            isOpen ? "rotate-180 text-primary-6" : "text-text-2"
          )}
        />
      </button>
    );
  }
);

BreadcrumbPillNavTrigger.displayName = "BreadcrumbPillNavTrigger";
