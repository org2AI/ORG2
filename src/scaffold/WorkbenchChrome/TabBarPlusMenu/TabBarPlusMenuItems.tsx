import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import {
  type WorkStationLaunchAction,
  getWorkStationLaunchSections,
} from "@src/modules/WorkStation/AppShell/useWorkStationLaunchActions";

interface TabBarPlusMenuItemsProps {
  actions: readonly WorkStationLaunchAction[];
  onActionComplete: () => void;
}

export function TabBarPlusMenuItems({
  actions,
  onActionComplete,
}: TabBarPlusMenuItemsProps) {
  const sections = getWorkStationLaunchSections(actions);

  return (
    <>
      {sections.map((section, sectionIndex) => (
        <React.Fragment key={section.id}>
          {sectionIndex > 0 ? (
            <div
              role="separator"
              className={DROPDOWN_CLASSES.menuGroupSeparator}
            />
          ) : null}
          {section.actions.map((action) => (
            <DropdownActionItem
              key={action.id}
              icon={
                <AnyIcon icon={action.icon} size={DROPDOWN_ITEM.iconSize} />
              }
              shortcutId={action.shortcutId}
              onClick={() => {
                action.onClick();
                onActionComplete();
              }}
            >
              {action.label}
            </DropdownActionItem>
          ))}
        </React.Fragment>
      ))}
    </>
  );
}
