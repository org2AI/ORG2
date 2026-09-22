import React, { useCallback } from "react";

import { SESSION_ROW_PRESENTATION } from "@src/components/SessionRowPresentation";
import { ReferenceDragGhost } from "@src/components/dnd/ReferenceDragGhost";
import { useImmediateCursorReset } from "@src/hooks/ui/useImmediateCursorReset";
import { ArrowRight01Icon, HugeiconsIcon } from "@src/icons";

import { SIDEBAR_STYLE } from "../../../config";
import type { NavigationMenuItem } from "../config";
import { NavigationMenuRowAccessorySlot } from "./RowAccessorySlot";
import {
  renderLeadingIcon,
  renderNavigationMenuHoverContent,
  renderRowActions,
} from "./renderRowParts";
import type {
  NavigationMenuIconRenderer,
  NavigationMenuItemClickHandler,
  NavigationMenuRowActionClickHandler,
  NavigationMenuRowMouseEnterHandler,
} from "./types";
import { useNavItemDrag } from "./useNavItemDrag";

interface NavigationMenuLeafRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  item: NavigationMenuItem;
  isChild: boolean;
  isSelected: boolean;
  collapsed: boolean;
  t: (key: string) => string;
  renderIcon: NavigationMenuIconRenderer;
  onMenuItemClick: NavigationMenuItemClickHandler;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowMouseEnter: NavigationMenuRowMouseEnterHandler;
  onRowActionClick: NavigationMenuRowActionClickHandler;
}

export const NavigationMenuLeafRow = React.forwardRef<
  HTMLDivElement,
  NavigationMenuLeafRowProps
>(function NavigationMenuLeafRow(
  {
    item,
    isChild,
    isSelected,
    collapsed,
    t,
    renderIcon,
    onMenuItemClick,
    onMenuItemContextMenu,
    onRowMouseEnter,
    onRowActionClick,
    onMouseEnter,
    onMouseLeave,
    ...rootProps
  },
  ref
): React.ReactElement {
  const isSecondaryTone = item.visualTone === "secondary";
  const iconColor = item.disabled
    ? isSecondaryTone
      ? "text-text-2"
      : "text-text-3"
    : isSelected
      ? "text-text-1"
      : isSecondaryTone
        ? "text-text-2"
        : "text-text-1";

  const { dragHandlers, dragState } = useNavItemDrag(item);
  const {
    cursorReset,
    markClicked,
    resetCursor: resetImmediateCursor,
  } = useImmediateCursorReset(isSelected, !item.disabled);
  const showIndentGuide = Boolean(item.showIndentGuide);

  const handleRootMouseLeave = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      resetImmediateCursor();
      onMouseLeave?.(event);
    },
    [resetImmediateCursor, onMouseLeave]
  );
  return (
    <div
      {...rootProps}
      {...dragHandlers}
      ref={ref}
      className={`${rootProps.className ?? ""} ${showIndentGuide ? "relative pl-4" : ""} ${item.dragPayload ? "cursor-grab active:cursor-grabbing" : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={handleRootMouseLeave}
      onContextMenu={(event: React.MouseEvent) =>
        onMenuItemContextMenu?.(event, item.key, item)
      }
    >
      {dragState && <ReferenceDragGhost dragState={dragState} />}
      {showIndentGuide && (
        <span className="pointer-events-none absolute -top-0.5 -bottom-0.5 left-2 w-px bg-border-3" />
      )}
      <div
        data-testid={item.dataTestId}
        data-tour-target={item.tourTarget}
        // Keep the shared mobile session-row geometry independent of sidebar density.
        style={{ height: SIDEBAR_STYLE.rowHeight }}
        data-menu-item-id={item.id}
        data-selected={isSelected ? "true" : "false"}
        role="button"
        tabIndex={item.disabled ? -1 : 0}
        aria-disabled={item.disabled || undefined}
        className={`group data-[sidebar-menu-open=true]:bg-sidebar-selected data-[sidebar-menu-open=true]:text-text-1 ${SESSION_ROW_PRESENTATION.row} ${
          isChild ? "pr-2 pl-5" : "px-2"
        } ${
          item.disabled
            ? isSecondaryTone
              ? "cursor-default text-text-2 opacity-60"
              : "cursor-default text-text-3 opacity-60"
            : isSelected
              ? "cursor-default bg-sidebar-selected text-text-1"
              : isSecondaryTone
                ? `${cursorReset ? "cursor-default" : "cursor-pointer"} text-text-2 hover:bg-sidebar-selected hover:text-text-1`
                : `${cursorReset ? "cursor-default" : "cursor-pointer"} text-text-1 hover:bg-sidebar-selected`
        }`}
        onClick={(event: React.MouseEvent) => {
          if (item.disabled) return;
          if (
            isSelected &&
            item.openContextMenuOnSelectedClick &&
            onMenuItemContextMenu
          ) {
            onMenuItemContextMenu(event, item.key, item);
            return;
          }
          markClicked();
          onMenuItemClick(item.key, item, event);
        }}
        onKeyDown={(event) => {
          // Secondary actions own their keyboard events.
          if (event.target !== event.currentTarget) return;

          if (item.disabled || (event.key !== "Enter" && event.key !== " ")) {
            return;
          }
          event.preventDefault();
          event.currentTarget.click();
        }}
        onMouseEnter={(event: React.MouseEvent) =>
          onRowMouseEnter(event, item.routePath)
        }
      >
        <div className={SESSION_ROW_PRESENTATION.content}>
          {renderLeadingIcon({
            item,
            iconColor,
            renderIcon,
          })}
          {!collapsed && (
            <div className={SESSION_ROW_PRESENTATION.text}>
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={`${SESSION_ROW_PRESENTATION.title} ${
                    item.disabled
                      ? isSecondaryTone
                        ? "text-text-2"
                        : "text-text-3"
                      : isSelected
                        ? "text-text-1"
                        : isSecondaryTone
                          ? "text-text-2"
                          : "text-text-1"
                  }`}
                >
                  {item.label}
                </span>
                {item.labelBadge}
              </span>
              {item.subtitle && (
                <span className={SESSION_ROW_PRESENTATION.subtitle}>
                  {item.subtitle}
                </span>
              )}
            </div>
          )}
        </div>
        {renderLeafRowAccessory({
          item,
          isSelected,
          collapsed,
          t,
          onMenuItemContextMenu,
          onRowActionClick,
        })}
      </div>
    </div>
  );
});

interface RenderLeafRowAccessoryArgs {
  item: NavigationMenuItem;
  isSelected: boolean;
  collapsed: boolean;
  t: (key: string) => string;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowActionClick: NavigationMenuRowActionClickHandler;
}

function renderLeafRowAccessory({
  item,
  isSelected,
  collapsed,
  t,
  onMenuItemContextMenu,
  onRowActionClick,
}: RenderLeafRowAccessoryArgs): React.ReactNode {
  if (collapsed) return null;

  if (item.showMoreActions) {
    return (
      <NavigationMenuRowAccessorySlot
        workingIndicatorContent={item.workingIndicator}
        persistentContent={item.trailingElement}
        hoverContent={renderNavigationMenuHoverContent(
          item,
          "max-w-16 truncate text-[11px] text-text-2"
        )}
        actionContent={renderRowActions({
          item,
          t,
          onMenuItemContextMenu,
          onRowActionClick,
        })}
      />
    );
  }

  if (
    !item.shortcut &&
    !item.trailingLabel &&
    !item.trailingElement &&
    !item.workingIndicator &&
    !item.showDrillDownIndicator
  ) {
    return null;
  }

  return (
    <NavigationMenuRowAccessorySlot
      workingIndicatorContent={item.workingIndicator}
      persistentContent={
        <>
          {item.trailingElement}
          {item.showDrillDownIndicator && (
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="chevron-right"
              size={12}
              strokeWidth={2}
              className={
                isSelected ? "shrink-0 text-text-1" : "shrink-0 text-text-2"
              }
            />
          )}
        </>
      }
      hoverContent={renderNavigationMenuHoverContent(
        item,
        "max-w-18 truncate text-[11px] text-text-3"
      )}
    />
  );
}
