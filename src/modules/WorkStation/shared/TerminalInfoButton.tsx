import React, { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { HugeiconsIcon, InformationCircleIcon } from "@src/icons";

export interface TerminalInfoButtonProps {
  name: string;
  pid?: number;
  shell?: string;
}

const TerminalInfoButtonComponent: React.FC<TerminalInfoButtonProps> = ({
  name,
  pid,
  shell,
}) => {
  const { t } = useTranslation();
  const [showTerminalInfo, setShowTerminalInfo] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTerminalInfo(true)}
      onMouseLeave={() => setShowTerminalInfo(false)}
    >
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        title={t("tooltips.showTerminalProcessInfo")}
        icon={
          <HugeiconsIcon
            icon={InformationCircleIcon}
            data-icon="info"
            size={HEADER_ICON_SIZE.md}
          />
        }
      />

      {showTerminalInfo ? (
        <div
          className={`absolute top-full right-0 z-50 mt-2 ${DROPDOWN_CLASSES.panel} ${DROPDOWN_PANEL.paddingClass} ${DROPDOWN_WIDTHS.panelWidthClass}`}
        >
          <div
            className={`flex flex-col ${DROPDOWN_PANEL.itemsGapClass} ${DROPDOWN_ITEM.fontSizeClass}`}
          >
            <div
              className={`flex items-center justify-between gap-6 ${DROPDOWN_ITEM.heightClass} ${DROPDOWN_ITEM.paddingXClass}`}
            >
              <span className="text-text-3">{t("common:common.name")}</span>
              <span className="truncate font-medium text-text-1">{name}</span>
            </div>
            {pid !== undefined ? (
              <div
                className={`flex items-center justify-between gap-6 ${DROPDOWN_ITEM.heightClass} ${DROPDOWN_ITEM.paddingXClass}`}
              >
                <span className="text-text-3">{t("common:common.pid")}</span>
                <span className="font-medium text-text-1">{pid}</span>
              </div>
            ) : null}
            <div
              className={`flex items-center justify-between gap-6 ${DROPDOWN_ITEM.heightClass} ${DROPDOWN_ITEM.paddingXClass}`}
            >
              <span className="text-text-3">{t("common:common.shell")}</span>
              <span className="truncate font-medium text-text-1">
                {shell ?? "zsh"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const TerminalInfoButton = memo(TerminalInfoButtonComponent);
TerminalInfoButton.displayName = "TerminalInfoButton";
