import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
} from "@src/components/layout/blocks";

import ComputerUseConfig from "./BuiltInTools/Preview/DesktopToolConfig";

const ComputerUseCategoryView: React.FC = () => {
  const { t } = useTranslation("integrations");
  const tabs = useMemo(
    () => [{ key: "desktop", label: t("builtInTools.tabDesktopControl") }],
    [t]
  );

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        tabs={tabs}
        activeTab="desktop"
        onTabChange={() => {}}
      />
      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-3`}
        >
          <ComputerUseConfig />
        </div>
      </div>
    </DetailPanelContainer>
  );
};

export default ComputerUseCategoryView;
