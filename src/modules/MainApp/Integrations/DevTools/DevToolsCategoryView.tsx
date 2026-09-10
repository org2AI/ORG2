import React from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  ScrollPreservation,
} from "@src/modules/shared/layouts/blocks";

import { ThirdPartyDisclaimer } from "../Tables/TrademarkDisclaimer";
import DependenciesPage from "./DependenciesPage";

/**
 * Dev Tools category — Dependencies only.
 *
 * The LSP and Lint tabs were archived along with the rest of the
 * user-facing LSP/lint surface (see `.archive/README.md`); language servers
 * and lint tools are now an agent-only capability.
 */
const DevToolsCategoryView: React.FC = () => {
  const { t } = useTranslation("settings");
  const depsRefreshRef = React.useRef<(() => Promise<void>) | null>(null);

  return (
    <DetailPanelContainer>
      <InternalHeader
        tabs={
          <TabPill
            tabs={[
              {
                key: "dependencies",
                label: t("dependencies.systemDependencies"),
              },
            ]}
            activeTab="dependencies"
            onChange={() => {}}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
      />
      <ScrollPreservation className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <div className="flex flex-col gap-3">
            <DependenciesPage refreshRef={depsRefreshRef} />
            <ThirdPartyDisclaimer />
          </div>
        </div>
      </ScrollPreservation>
    </DetailPanelContainer>
  );
};

export default DevToolsCategoryView;
