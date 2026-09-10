/**
 * HTTP version preference for LLM provider connections.
 * Shown in General settings; uses `network.httpVersion` in settings.jsonc.
 */
import {
  SECTION_CONTROL_STYLE,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import { HintWithInfo } from "@src/modules/shared/layouts/blocks/HintWithInfo";
import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

const HTTP_VERSION_VALUES = ["auto", "http1", "http2"] as const;

const HttpVersionSettingsBlock: React.FC = () => {
  const { t } = useTranslation("settings");
  const settings = useAtomValue(settingsAtom);
  const updateSetting = useSetAtom(updateSettingAtom);
  const httpVersion =
    (settings["network.httpVersion"] as string | undefined) ?? "auto";

  const options = HTTP_VERSION_VALUES.map((value) => ({
    value,
    label: t(`monitor.httpVersionOption.${value}`),
  }));

  return (
    <SectionRow
      label={
        <span className="inline-flex items-center gap-1">
          {t("monitor.httpVersion")}
          <HintWithInfo
            content={t("monitor.httpVersionDesc")}
            position="right"
          />
        </span>
      }
    >
      <Select
        value={httpVersion}
        onChange={(value) =>
          updateSetting({ key: "network.httpVersion", value })
        }
        options={options}
        style={SECTION_CONTROL_STYLE}
      />
    </SectionRow>
  );
};

export default HttpVersionSettingsBlock;
