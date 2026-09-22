import React, { useId } from "react";

import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import { HugeiconsIcon, WorkHistoryIcon } from "@src/icons";

export interface RecentTabMenuItem {
  id: string;
  title: string;
  leadingIcon?: React.ReactNode;
}

interface RecentTabsMenuSectionProps {
  tabs: readonly RecentTabMenuItem[];
  label: string;
  onOpen: (tabId: string) => void;
}

export function RecentTabsMenuSection({
  tabs,
  label,
  onOpen,
}: RecentTabsMenuSectionProps): React.ReactNode {
  const labelId = useId();

  if (tabs.length === 0) return null;

  return (
    <>
      <div className={DROPDOWN_CLASSES.menuGroupSeparator} aria-hidden />
      <div role="group" aria-labelledby={labelId}>
        <div id={labelId} className={DROPDOWN_CLASSES.sectionLabel}>
          {label}
        </div>
        {tabs.map((tab) => (
          <DropdownActionItem
            key={tab.id}
            icon={
              tab.leadingIcon ?? (
                <HugeiconsIcon
                  icon={WorkHistoryIcon}
                  data-icon="work-history"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.8}
                />
              )
            }
            labelClassName="max-w-[320px]"
            data-recent-tab-id={tab.id}
            onClick={() => onOpen(tab.id)}
          >
            {tab.title}
          </DropdownActionItem>
        ))}
      </div>
    </>
  );
}
