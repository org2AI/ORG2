/** Region/integration actions and the Agent Teams add menu for SettingsSlot. */
import React, { useState } from "react";

import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import Tooltip from "@src/components/Tooltip";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { Add01Icon, HugeiconsIcon } from "@src/icons";
import type {
  RouteToolbarButton,
  ToolbarDropdownItem,
} from "@src/store/ui/routeToolbarAtom";

import { useRouteToolbarConfig } from "../hooks/useRouteToolbarConfig";

interface HeaderIconButtonProps {
  item: RouteToolbarButton;
}

const HeaderIconButton: React.FC<HeaderIconButtonProps> = ({ item }) => {
  if (item.element) {
    return <>{item.element}</>;
  }

  const icon =
    item.iconElement ??
    (item.icon ? (
      <HugeiconsIcon
        icon={item.icon}
        size={HEADER_ICON_SIZE.sm}
        strokeWidth={2}
        className={item.iconClassName}
      />
    ) : null);
  const title = item.title ?? item.id;

  const button = (
    <TabBarTrailingIconButton
      title={title}
      nativeTitle={!item.tooltipContent}
      onClick={item.onClick}
      disabled={item.disabled}
      aria-label={title}
      aria-pressed={item.selected}
      active={item.selected}
    >
      {icon}
    </TabBarTrailingIconButton>
  );

  if (!item.tooltipContent) return button;

  return (
    <Tooltip
      content={item.tooltipContent}
      position="bottom-end"
      mouseEnterDelay={200}
      framedPanel
    >
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
};

interface CompactPlusDropdownProps {
  items: ToolbarDropdownItem[];
  title: string;
}

const CompactPlusDropdown: React.FC<CompactPlusDropdownProps> = ({
  items,
  title,
}) => {
  const [open, setOpen] = useState(false);

  const droplist = (
    <div
      className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.wideMenuClass}`}
    >
      {items.map((item) => {
        const icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`settings-plus-dropdown-item-${item.id}`}
            onClick={() => {
              setOpen(false);
              item.onClick();
            }}
            className={DROPDOWN_CLASSES.menuActionItem}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <HugeiconsIcon
                icon={icon}
                size={HEADER_ICON_SIZE.sm}
                strokeWidth={1.75}
                className="text-text-1"
              />
              <span className="truncate">{item.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      position="bottom-end"
      trigger="click"
      popupVisible={open}
      onVisibleChange={setOpen}
      getPopupContainer={() => document.body}
    >
      <span className="inline-flex">
        <TabBarTrailingIconButton
          title={title}
          nativeTitle={false}
          tooltipDisabled
          aria-label={title}
          aria-expanded={open}
          active={open}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={HEADER_ICON_SIZE.md}
            strokeWidth={2}
          />
        </TabBarTrailingIconButton>
      </span>
    </Dropdown>
  );
};

const SettingsHeaderActions: React.FC = () => {
  const routeToolbarConfig = useRouteToolbarConfig();

  const extraButtons = routeToolbarConfig?.extraButtons ?? [];
  const plusItems = routeToolbarConfig?.plusDropdownItems;
  const hasPlus = plusItems && plusItems.length > 0;

  if (extraButtons.length === 0 && !hasPlus) {
    return null;
  }

  return (
    <>
      {extraButtons.map((item) => (
        <HeaderIconButton key={item.id} item={item} />
      ))}
      {hasPlus && <CompactPlusDropdown items={plusItems} title="Add" />}
    </>
  );
};

export default SettingsHeaderActions;
