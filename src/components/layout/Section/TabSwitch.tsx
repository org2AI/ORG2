/**
 * SectionTabSwitch Component
 *
 * Reusable tab switcher for use inside SectionLayout pages.
 * Renders a sticky TabPill (variant="simple")
 * at the top of a section, switching between different content views.
 *
 * @example
 * ```tsx
 * <SectionTabSwitch
 *   tabs={[
 *     { key: "repo", label: t("settings.repoMembers") },
 *     { key: "workspace", label: t("settings.workspaceMembers") },
 *   ]}
 *   activeTab={activeTab}
 *   onChange={setActiveTab}
 * />
 * ```
 */
import React, { memo } from "react";

import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";

export interface SectionTabSwitchProps {
  /** Tab items — shorthand strings or full TabPillItem objects */
  tabs: (TabPillItem | string)[];
  /** Currently active tab key */
  activeTab: string;
  /** Callback when tab changes */
  onChange: (key: string) => void;
}

const SectionTabSwitch: React.FC<SectionTabSwitchProps> = memo(
  ({ tabs, activeTab, onChange }) => {
    return (
      <div className="sticky top-[47px] z-30 bg-bg-2 pb-1 pl-1">
        <TabPill
          tabs={tabs}
          activeTab={activeTab}
          onChange={onChange}
          variant="simple"
          fillWidth={false}
          size="default"
        />
      </div>
    );
  }
);

SectionTabSwitch.displayName = "SectionTabSwitch";

export default SectionTabSwitch;
