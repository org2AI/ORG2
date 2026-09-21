import React, { useCallback } from "react";

import { ReferenceDragGhost } from "@src/components/dnd/ReferenceDragGhost";
import { useImmediateCursorReset } from "@src/hooks/ui/useImmediateCursorReset";
import { ChevronsDownUpIcon, HugeiconsIcon, UnfoldMoreIcon } from "@src/icons";

import type { NavigationMenuItem } from "../config";
import { NavigationMenuRowAccessorySlot } from "./RowAccessorySlot";
import { NavigationMenuRowActionButton } from "./RowActionButton";
import {
  renderLeadingIcon,
  renderNavigationMenuHoverContent,
  renderRowActions,
} from "./renderRowParts";
import type {
  NavigationMenuIconRenderer,
  NavigationMenuItemClickHandler,
  NavigationMenuItemRenderer,
  NavigationMenuRowActionClickHandler,
  NavigationMenuRowMouseEnterHandler,
} from "./types";
import { useNavItemDrag } from "./useNavItemDrag";

export { NavigationMenuLeafRow } from "./NavigationMenuLeafRow";

interface NavigationMenuParentRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  item: NavigationMenuItem;
  isChild: boolean;
  isOpen: boolean;
  submenuSelected: boolean;
  collapsed: boolean;
  t: (key: string) => string;
  renderIcon: NavigationMenuIconRenderer;
  renderMenuItem: NavigationMenuItemRenderer;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowMouseEnter: NavigationMenuRowMouseEnterHandler;
  onRowActionClick: NavigationMenuRowActionClickHandler;
  onToggleSubmenu: (key: string) => void;
  /** Present when `item.navigableParent`: a body click selects the item. */
  onMenuItemClick?: NavigationMenuItemClickHandler;
}

export const NavigationMenuParentRow = React.forwardRef<
  HTMLDivElement,
  NavigationMenuParentRowProps
>(function NavigationMenuParentRow(
  {
    item,
    isChild,
    isOpen,
    submenuSelected,
    collapsed,
    t,
    renderIcon,
    renderMenuItem,
    onMenuItemContextMenu,
    onRowMouseEnter,
    onRowActionClick,
    onToggleSubmenu,
    onMenuItemClick,
    onMouseEnter,
    onMouseLeave,
    ...rootProps
  },
  ref
): React.ReactElement {
  const iconColor = "text-text-1";
  // Navigable parent: the row body opens the item (like a leaf); only the
  // chevron toggles the submenu. Group headers (no flag) toggle on body.
  const navigable = Boolean(item.navigableParent && onMenuItemClick);
  const { dragHandlers, dragState } = useNavItemDrag(item);
  const {
    cursorReset,
    markClicked,
    resetCursor: resetImmediateCursor,
  } = useImmediateCursorReset(submenuSelected, !item.disabled);

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
      className={`${rootProps.className ?? ""} ${item.dragPayload ? "cursor-grab active:cursor-grabbing" : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={handleRootMouseLeave}
      onContextMenu={
        onMenuItemContextMenu
          ? (event: React.MouseEvent) =>
              onMenuItemContextMenu(event, item.key, item)
          : undefined
      }
    >
      {dragState && (
        <ReferenceDragGhost
          dragState={{
            ...dragState,
            dragIcon: renderIcon(
              item.icon,
              item.iconName,
              iconColor,
              item.iconElement
            ),
          }}
        />
      )}
      <div
        data-testid={item.dataTestId}
        data-tour-target={item.tourTarget}
        data-menu-item-id={item.id}
        role="button"
        tabIndex={item.disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-disabled={item.disabled || undefined}
        className={`group/parent flex h-7 items-center ${
          item.disclosureFollowsLabel ? "justify-start" : "justify-between"
        } rounded-lg transition-colors duration-150 ${
          isChild ? "pr-2 pl-5" : "px-2"
        } ${submenuSelected ? "bg-sidebar-selected text-text-1" : "text-text-1"} ${
          item.disabled
            ? "cursor-default opacity-60"
            : `${cursorReset ? "cursor-default" : "cursor-pointer"} hover:bg-sidebar-selected`
        }`}
        onClick={(event: React.MouseEvent) => {
          if (item.disabled) return;
          markClicked();
          if (navigable) {
            onMenuItemClick?.(item.key, item, event);
          } else {
            onToggleSubmenu(item.key);
          }
        }}
        onKeyDown={(event) => {
          // Secondary actions own their keyboard events.
          if (event.target !== event.currentTarget) return;

          if (item.disabled || (event.key !== "Enter" && event.key !== " ")) {
            return;
          }
          event.preventDefault();
          markClicked();
          if (navigable) {
            onMenuItemClick?.(
              item.key,
              item,
              event as unknown as React.MouseEvent
            );
          } else {
            onToggleSubmenu(item.key);
          }
        }}
        onMouseEnter={(event: React.MouseEvent) =>
          onRowMouseEnter(event, item.routePath)
        }
      >
        <div
          className={`flex min-w-0 items-center gap-3 ${
            item.disclosureFollowsLabel ? "" : "flex-1"
          }`}
        >
          {renderLeadingIcon({
            item,
            iconColor,
            renderIcon,
          })}
          {!collapsed && (
            <div
              className={`flex min-w-0 flex-col gap-0 ${
                item.disclosureFollowsLabel ? "" : "flex-1"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="truncate text-[13px] leading-4 text-text-1">
                  {item.label}
                </span>
                {item.labelBadge}
              </span>
              {item.subtitle && (
                <span className="flex min-w-0 items-center gap-1 truncate text-[11px] leading-3 text-text-3">
                  {item.subtitle}
                </span>
              )}
            </div>
          )}
        </div>
        {!collapsed && (
          <span
            className={`${item.disclosureFollowsLabel ? "ml-2" : "ml-1"} inline-flex shrink-0 items-center gap-1.5 leading-none`}
          >
            {/* Cloud thread roots carry hover metadata (owner · time) and
                Fork/More actions; parentHoverGroup keys the reveal on the
                named group so nested child rows can't capture it. */}
            <NavigationMenuRowAccessorySlot
              parentHoverGroup
              persistentContent={item.trailingElement}
              hoverContent={renderNavigationMenuHoverContent(
                item,
                "max-w-24 truncate text-[11px] text-text-2"
              )}
              actionContent={
                item.showMoreActions
                  ? renderRowActions({
                      item,
                      t,
                      onMenuItemContextMenu,
                      onRowActionClick,
                    })
                  : undefined
              }
            />
            {item.disclosureFollowsLabel ? (
              isOpen ? (
                <HugeiconsIcon
                  icon={ChevronsDownUpIcon}
                  data-icon="chevrons-down-up"
                  size={12}
                  strokeWidth={2}
                  className="shrink-0 text-text-2"
                />
              ) : (
                <HugeiconsIcon
                  icon={UnfoldMoreIcon}
                  data-icon="chevrons-up-down"
                  size={12}
                  strokeWidth={2}
                  className="shrink-0 text-text-2"
                />
              )
            ) : (
              <NavigationMenuRowActionButton
                icon={isOpen ? ChevronsDownUpIcon : UnfoldMoreIcon}
                label={t("actions.toggle")}
                dataTestId={
                  item.dataTestId ? `${item.dataTestId}-toggle` : undefined
                }
                onClick={() => onToggleSubmenu(item.key)}
              />
            )}
          </span>
        )}
      </div>

      {isOpen && !collapsed && item.children && (
        <div className="mt-1 space-y-1">
          {item.children.map((child) => (
            <React.Fragment key={child.key}>
              {renderMenuItem(child, true)}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
});
