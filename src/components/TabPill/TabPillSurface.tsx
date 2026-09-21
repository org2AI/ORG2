import React, { useCallback } from "react";

import Button from "@src/components/Button";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { useImmediateCursorReset } from "@src/hooks/ui/useImmediateCursorReset";

type TabPillElement = HTMLButtonElement | HTMLDivElement;

export interface TabPillSurfaceProps extends React.HTMLAttributes<TabPillElement> {
  as?: "button" | "div";
  isActive: boolean;
  isDragging?: boolean;
  variant?: "standard" | "session";
}

const VARIANT_CLASSES: Record<
  NonNullable<TabPillSurfaceProps["variant"]>,
  string
> = {
  standard: "min-w-14 max-w-[240px] shrink-0 gap-1.5 px-2.5",
  session: "min-w-0 max-w-[120px] shrink-0 gap-1.5 px-2.5",
};

export const TAB_PILL_DRAG_OVERLAY_CLASS = `flex h-7 shrink-0 cursor-grabbing items-center gap-1.5 rounded-[10px] border border-border-2 ${SURFACE_TOKENS.selected} pl-2.5 pr-2 text-text-1 shadow-lg`;

export const TabPillSurface = React.forwardRef<
  TabPillElement,
  TabPillSurfaceProps
>(
  (
    {
      as = "div",
      isActive,
      isDragging = false,
      variant = "standard",
      className = "",
      children,
      onClick,
      onMouseLeave,
      ...props
    },
    ref
  ) => {
    const { cursorReset, markClicked, resetCursor } = useImmediateCursorReset(
      isActive,
      Boolean(onClick)
    );

    const handleClick = useCallback(
      (event: React.MouseEvent<TabPillElement>) => {
        markClicked();
        onClick?.(event);
      },
      [markClicked, onClick]
    );

    const handleMouseLeave = useCallback(
      (event: React.MouseEvent<TabPillElement>) => {
        resetCursor();
        onMouseLeave?.(event);
      },
      [onMouseLeave, resetCursor]
    );

    const stateClass = isActive
      ? `work-station-editor-tab--active z-10 ${SURFACE_TOKENS.selected} text-text-1 ${SURFACE_TOKENS.selectedHover}`
      : `bg-transparent text-text-2 ${SURFACE_TOKENS.hover}`;
    const draggingClass = isDragging
      ? `work-station-editor-tab--dragging cursor-grabbing ${SURFACE_TOKENS.selected} opacity-90`
      : "";
    const cursorClass = isDragging
      ? "cursor-grabbing"
      : !isActive && !cursorReset && onClick
        ? "cursor-pointer"
        : "cursor-default";
    const radiusClass = isActive
      ? "rounded-[10px]"
      : "rounded-lg hover:rounded-[10px]";
    const surfaceClassName = `work-station-editor-tab relative flex h-7 min-w-0 ${cursorClass} select-none items-center overflow-hidden ${radiusClass} transition-colors duration-150 ${VARIANT_CLASSES[variant]} ${stateClass} ${draggingClass} ${className}`;

    if (as === "button") {
      return (
        <Button
          layout="custom"
          ref={ref as React.Ref<HTMLButtonElement>}
          className={surfaceClassName}
          onClick={handleClick as React.MouseEventHandler<HTMLButtonElement>}
          onMouseLeave={
            handleMouseLeave as React.MouseEventHandler<HTMLButtonElement>
          }
          {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {children}
        </Button>
      );
    }

    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        className={surfaceClassName}
        onClick={handleClick as React.MouseEventHandler<HTMLDivElement>}
        onMouseLeave={
          handleMouseLeave as React.MouseEventHandler<HTMLDivElement>
        }
        {...(props as React.HTMLAttributes<HTMLDivElement>)}
      >
        {children}
      </div>
    );
  }
);

TabPillSurface.displayName = "TabPillSurface";
