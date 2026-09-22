import type React from "react";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { KeyboardShortcut } from "@src/components/KeyboardShortcut";
import { SESSION_ROW_PRESENTATION } from "@src/components/SessionRowPresentation";
import { ArrowDown01Icon } from "@src/icons";

import type { NavigationMenuItem } from "../config";
import { NavigationMenuRowActionButton } from "./RowActionButton";
import type {
  NavigationMenuIconRenderer,
  NavigationMenuRowActionClickHandler,
} from "./types";

export function renderNavigationMenuHoverContent(
  item: NavigationMenuItem,
  trailingLabelClassName: string
): React.ReactNode {
  if (item.shortcut) {
    return (
      <KeyboardShortcut shortcut={item.shortcut} size="sm" rendering="icons" />
    );
  }
  if (item.trailingLabel) {
    return <span className={trailingLabelClassName}>{item.trailingLabel}</span>;
  }
  return undefined;
}

interface RenderLeadingIconArgs {
  item: NavigationMenuItem;
  iconColor: string;
  renderIcon: NavigationMenuIconRenderer;
}

export function renderLeadingIcon({
  item,
  iconColor,
  renderIcon,
}: RenderLeadingIconArgs): React.ReactNode {
  const icon = renderIcon(
    item.icon,
    item.iconName,
    iconColor,
    item.iconElement
  );
  const action = item.iconAction;
  if (!action && !item.iconBadge) return icon;

  const ActionIcon = action?.icon ?? ArrowDown01Icon;

  return (
    <span className={SESSION_ROW_PRESENTATION.leadingIcon}>
      {action ? (
        <>
          <span className="inline-flex items-center justify-center leading-none transition-opacity duration-150 group-focus-within:pointer-events-none group-focus-within:opacity-0 group-hover:pointer-events-none group-hover:opacity-0">
            {icon}
          </span>
          <Button
            aria-label={action.label}
            title={action.label}
            className={`pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 opacity-0 duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 focus:outline-none`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              action.onClick(event);
            }}
            aria-pressed={action.active}
            size="sidebar"
            variant="tertiary"
            iconOnly
            icon={
              <AnyIcon
                icon={ActionIcon}
                size={14}
                strokeWidth={2}
                className={action.iconClassName}
              />
            }
          />
        </>
      ) : (
        icon
      )}
      {item.iconBadge && (
        <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex rounded-full bg-bg-1 ring-1 ring-bg-1">
          {item.iconBadge}
        </span>
      )}
    </span>
  );
}

interface RenderRowActionsArgs {
  item: NavigationMenuItem;
  t: (key: string) => string;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowActionClick: NavigationMenuRowActionClickHandler;
}

export function renderRowActions({
  item,
  t,
  onMenuItemContextMenu,
  onRowActionClick,
}: RenderRowActionsArgs): React.ReactNode {
  if (item.rowActions?.length) {
    return item.rowActions.map((action, actionIndex) => (
      <NavigationMenuRowActionButton
        key={`${action.label}:${actionIndex}`}
        icon={action.icon}
        dataIcon={action.dataIcon}
        iconClassName={action.iconClassName}
        label={action.label}
        active={action.active}
        dataTestId={action.dataTestId}
        onClick={action.onClick}
      />
    ));
  }

  if (!onMenuItemContextMenu && !item.onRowActionClick) return undefined;

  return (
    <NavigationMenuRowActionButton
      icon={item.rowActionIcon}
      label={item.rowActionLabel ?? t("actions.more")}
      onClick={(event) => onRowActionClick(event, item)}
    />
  );
}
