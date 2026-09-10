import React from "react";
import { useTranslation } from "react-i18next";

import type { CursorRepo } from "@src/hooks/policies";
import InlineExternalImport from "@src/scaffold/WizardSystem/shared/externalImport/InlineExternalImport";

interface InlineExternalAgentsImportProps {
  cursorRepos?: CursorRepo[];
  onAfterImport?: () => void | Promise<void>;
}

const InlineExternalAgentsImport: React.FC<InlineExternalAgentsImportProps> = ({
  cursorRepos,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  return (
    <InlineExternalImport
      kind="agent_definition"
      labels={{
        title: t("agentOrgs.importAgentTitle"),
        empty: t("agentOrgs.externalImport.noAgentResults"),
        allImported: t("agentOrgs.allImported", {
          item: t("agentOrgs.importedItemAgents"),
        }),
        itemColumn: t("agentOrgs.importAgentColumn"),
      }}
      cursorRepos={cursorRepos}
      onAfterImport={onAfterImport}
      importableCheck="filtered"
    />
  );
};

export default InlineExternalAgentsImport;
