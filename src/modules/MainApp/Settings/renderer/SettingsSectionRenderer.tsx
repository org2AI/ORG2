import React from "react";
import { useTranslation } from "react-i18next";

import { getSettingsSectionById } from "@src/config/settingsUiManifest";
import { createLogger } from "@src/hooks/logger";

import { settingsSectionSlotRegistry } from "./slotRegistry";

const log = createLogger("SettingsRenderer");

interface SettingsSectionRendererProps {
  sectionId: string;
  activeTab?: string;
}

const SettingsSectionRenderer: React.FC<SettingsSectionRendererProps> = ({
  sectionId,
  activeTab,
}) => {
  const { t } = useTranslation("settings");
  const section = getSettingsSectionById(sectionId);

  if (!section) {
    return null;
  }

  const SectionSlot = section.customSectionSlotId
    ? settingsSectionSlotRegistry[section.customSectionSlotId]
    : undefined;

  if (section.customSectionSlotId && !SectionSlot) {
    log.error(
      "[SettingsRenderer] Missing section slot for id:",
      section.customSectionSlotId
    );
  }

  return (
    <div id={section.id} className="scroll-mt-4">
      <div className="flex flex-col gap-3">
        {SectionSlot ? (
          <SectionSlot activeTab={activeTab} />
        ) : (
          <div className="text-xs text-danger-6">
            {t("common:status.error", "Error")}: section renderer is not
            configured.
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsSectionRenderer;
