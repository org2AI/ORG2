/**
 * Runtime → Scanning: the shared source-scanning settings under Runtime's
 * section title. Settings → Import renders the same body.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import { SECTION_GAP_CLASSES } from "@src/components/layout/Section";
import SourceScanningSettings from "@src/features/ExternalSessionSources/SourceScanningSettings";

import { RuntimeSectionHeader } from "./RuntimeSectionHeader";

const RuntimeScanningPanel: React.FC = () => {
  const { t } = useTranslation("sessions", {
    keyPrefix: "kanban.dataSource",
  });

  return (
    <div className={SECTION_GAP_CLASSES} data-testid="runtime-scanning-panel">
      <RuntimeSectionHeader
        title={t("views.scanning")}
        className="-mx-4 bg-chat-pane px-4 pt-2 pb-1"
        dataTestId="runtime-scanning-title"
      />
      <SourceScanningSettings />
    </div>
  );
};

export default RuntimeScanningPanel;
