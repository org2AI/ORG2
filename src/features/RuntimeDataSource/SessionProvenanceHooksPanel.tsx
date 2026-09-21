/**
 * Runtime → Hooks: the shared session-provenance hook settings under
 * Runtime's section title. Settings → Import renders the same body.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import { SECTION_GAP_CLASSES } from "@src/components/layout/Section";
import SessionProvenanceHooksSettings from "@src/features/ExternalSessionSources/SessionProvenanceHooksSettings";

import { RuntimeSectionHeader } from "./RuntimeSectionHeader";

const SessionProvenanceHooksPanel: React.FC = () => {
  const { t } = useTranslation("integrations");

  return (
    <div
      className={SECTION_GAP_CLASSES}
      data-testid="session-provenance-hooks-panel"
    >
      <RuntimeSectionHeader
        title={t("agentOrgs.sessionProvenance.title")}
        className="-mx-4 bg-chat-pane px-4 pt-2 pb-1"
        dataTestId="session-provenance-hooks-title"
      />
      <SessionProvenanceHooksSettings />
    </div>
  );
};

export default SessionProvenanceHooksPanel;
