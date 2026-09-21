/**
 * Narrow-layout projection of the focused-chat workstation rail: a pinned
 * header trigger (portaled into the chat header) that drops the same section
 * list down as a menu.
 */
import type React from "react";
import { createPortal } from "react-dom";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import { HugeiconsIcon, LayoutListIcon } from "@src/icons";

import { WorkstationSections } from "./WorkstationSections";
import type { FocusedChatRailSection } from "./types";

export interface WorkstationCompactMenuProps {
  additionalInsideRefs: ReadonlyArray<React.RefObject<HTMLElement | null>>;
  collapseGroupLabel: string;
  collapsedGroupKeys: ReadonlySet<string>;
  expandGroupLabel: string;
  host: HTMLSpanElement;
  label: string;
  menuOpen: boolean;
  onRequestClose: () => void;
  onToggleGroup: (groupKey: string) => void;
  onVisibleChange: (visible: boolean) => void;
  sections: FocusedChatRailSection[];
}

export function WorkstationCompactMenu({
  additionalInsideRefs,
  collapseGroupLabel,
  collapsedGroupKeys,
  expandGroupLabel,
  host,
  label,
  menuOpen,
  onRequestClose,
  onToggleGroup,
  onVisibleChange,
  sections,
}: WorkstationCompactMenuProps) {
  return createPortal(
    <span className="inline-flex @[1100px]/focusedchat:hidden">
      <Dropdown
        position="bottom-end"
        popupVisible={menuOpen}
        onVisibleChange={onVisibleChange}
        // The subagents submenu is portaled to document.body; treat it as
        // part of this menu so interacting with it keeps the menu open.
        additionalInsideRefs={additionalInsideRefs}
        className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} w-72`}
        droplist={
          <div
            data-workstation-submenu-bounds=""
            className={`${DROPDOWN_CLASSES.optionsContainerOverlay} max-h-96`}
          >
            <WorkstationSections
              compact
              collapseGroupLabel={collapseGroupLabel}
              collapsedGroupKeys={collapsedGroupKeys}
              expandGroupLabel={expandGroupLabel}
              onRequestClose={onRequestClose}
              onToggleGroup={onToggleGroup}
              sections={sections}
            />
          </div>
        }
      >
        <Button
          variant="tertiary"
          size="small"
          iconOnly
          className={menuOpen ? "bg-fill-1! text-primary-6!" : ""}
          aria-label={label}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          icon={
            <HugeiconsIcon
              icon={LayoutListIcon}
              data-icon="layout-list"
              size={14}
              strokeWidth={2}
            />
          }
        />
      </Dropdown>
    </span>,
    host
  );
}
