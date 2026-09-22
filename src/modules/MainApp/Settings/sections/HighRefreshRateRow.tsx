import { SectionRow } from "@/src/components/layout/Section";
import { useAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import Switch from "@src/components/Switch";
import { HintWithInfo } from "@src/components/layout/blocks/HintWithInfo";
import {
  HOST_DESKTOP,
  resolveHostDesktop,
} from "@src/config/windowChromeRadius";
import { highRefreshRateAtom } from "@src/store/platform/highRefreshRateAtom";

/**
 * Only WKWebView paces rendering below the display rate; WebView2 already
 * follows the display, so the toggle would do nothing elsewhere.
 */
export const HIGH_REFRESH_RATE_SUPPORTED =
  resolveHostDesktop() === HOST_DESKTOP.MACOS;

interface HighRefreshRateRowProps {
  /** Set on the copy global settings search navigates to. */
  settingsSearchKeys?: string;
}

/** `general.highRefreshRate`, offered in both Appearance and General. */
export const HighRefreshRateRow: React.FC<HighRefreshRateRowProps> = ({
  settingsSearchKeys,
}) => {
  const { t } = useTranslation("settings");
  const [highRefreshRate, setHighRefreshRate] = useAtom(highRefreshRateAtom);

  return (
    <SectionRow
      settingsSearchKeys={settingsSearchKeys}
      label={
        <span className="inline-flex items-center gap-1">
          {t("general.highRefreshRate")}
          <HintWithInfo
            content={t("general.highRefreshRateDesc")}
            position="right"
          />
        </span>
      }
    >
      <Switch checked={highRefreshRate} onCheckedChange={setHighRefreshRate} />
    </SectionRow>
  );
};
