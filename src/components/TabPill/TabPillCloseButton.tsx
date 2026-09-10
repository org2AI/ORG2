import React from "react";

import { SURFACE_TOKENS } from "@src/config/surfaceTokens";

export interface TabPillCloseButtonProps {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  /** Placement only; shared appearance and visibility belong to this control. */
  className: string;
  visible: boolean;
  /** When true, an unsaved dot is shown and swaps to the X per `showX`. */
  hasUnsaved?: boolean;
  /** Whether the X lines are visible. */
  showX: boolean;
  tabIndex?: number;
  "data-action"?: string;
  "data-action-id"?: string;
}

/**
 * Close control for pill tabs: 14px X, optional
 * in-flow unsaved dot. Parent supplies placement and visibility.
 */
export const TabPillCloseButton: React.FC<TabPillCloseButtonProps> = ({
  onPointerDown,
  onClick,
  title,
  className,
  visible,
  hasUnsaved = false,
  showX,
  tabIndex = -1,
  "data-action": dataAction,
  "data-action-id": dataActionId,
}) => (
  <button
    type="button"
    tabIndex={tabIndex}
    title={title}
    data-action={dataAction}
    data-action-id={dataActionId}
    onPointerDown={onPointerDown}
    onClick={onClick}
    className={`grid place-items-center rounded text-text-3 transition-[opacity,colors,background-color] duration-150 ${SURFACE_TOKENS.hover} hover:text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6 focus-visible:ring-offset-0 ${className} ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {hasUnsaved && (
        <circle
          cx="12"
          cy="12"
          r="7"
          className="fill-text-1 transition-opacity duration-150"
          style={{ opacity: showX ? 0 : 1 }}
        />
      )}
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-opacity duration-150"
        style={{ opacity: showX ? 1 : 0 }}
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </g>
    </svg>
  </button>
);

TabPillCloseButton.displayName = "TabPillCloseButton";
