import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { InlineBanner } from "@src/components/InlineBanner";
import Select, { type SelectOption } from "@src/components/Select";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import {
  APPEARANCE_MODE,
  type GlobalThemePreference,
  THEME_PREFERENCE,
} from "@src/config/appearance/globalThemes";
import { createLogger } from "@src/hooks/logger";
import {
  ArrowRight02Icon,
  HugeiconsIcon,
  LaptopIcon,
  PaintBrush01Icon,
} from "@src/icons";

import { useMobileRemote } from "../../app";
import { useMobileTheme } from "../../appearance";
import { MobileTopBar } from "../../components/MobileTopBar";
import { MobileProfileEntry } from "../../components/profile/MobileProfileEntry";
import "./mobileSettings.scss";

const logger = createLogger("mobile-settings");

function presenceLabel(
  presence: "online" | "offline" | "unknown",
  t: (key: string) => string
): string {
  switch (presence) {
    case "online":
      return t("settings.online");
    case "offline":
      return t("settings.offline");
    default:
      return t("settings.notAvailable");
  }
}

export interface SettingsTabProps {
  onOpenDevices: () => void;
}

/** Connection preferences and one entry into the shared account destination. */
export function SettingsTab({ onOpenDevices }: SettingsTabProps) {
  const { t } = useTranslation("mobileRemote");
  const { connection } = useMobileRemote();
  const { preference, status: themeStatus, setPreference } = useMobileTheme();

  const themeOptions: SelectOption[] = [
    { value: THEME_PREFERENCE.SYSTEM, label: t("settings.themeSystem") },
    { value: APPEARANCE_MODE.LIGHT, label: t("settings.themeLight") },
    { value: APPEARANCE_MODE.DARK, label: t("settings.themeDark") },
  ];

  return (
    <>
      <div className="mobile-settings-header">
        <MobileTopBar title={t("settings.title")} />
      </div>
      {connection.demoMode ? (
        <InlineBanner tone="info">{t("settings.demoBanner")}</InlineBanner>
      ) : null}
      <div className="mobile-flow-screen mobile-settings flex-1">
        <div className="mobile-settings__content">
          <SectionContainer
            className="mobile-settings__card mobile-settings__account"
            dataTestId="mobile-remote-account-settings"
          >
            <SectionRow showHeader={false} className="!py-0">
              <MobileProfileEntry variant="row" />
            </SectionRow>
          </SectionContainer>

          <SectionContainer
            className="mobile-settings__card"
            dataTestId="mobile-remote-preferences"
          >
            <SectionContainer
              className="mobile-settings__section"
              dataTestId="mobile-remote-connection-settings"
            >
              <SectionRow showHeader={false} className="mobile-settings__row">
                <Button
                  layout="custom"
                  className="mobile-settings__device-entry"
                  onClick={onOpenDevices}
                >
                  <SettingsLabel
                    icon={LaptopIcon}
                    text={t("settings.connectionDevices")}
                  />
                  <span className="mobile-settings__desktop">
                    <span
                      className="mobile-settings__desktop-name"
                      title={connection.desktopName}
                    >
                      {connection.desktopName || t("settings.notAvailable")}
                    </span>
                    <span className="mobile-settings__presence">
                      <span
                        className={`mobile-settings__status-dot mobile-settings__status-dot--${connection.presence}`}
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {presenceLabel(connection.presence, t)}
                      </span>
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight02Icon}
                      size={16}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                  </span>
                </Button>
              </SectionRow>
            </SectionContainer>

            <SectionContainer
              className="mobile-settings__section"
              dataTestId="mobile-remote-appearance-settings"
            >
              <SectionRow
                label={
                  <SettingsLabel
                    icon={PaintBrush01Icon}
                    text={t("settings.theme")}
                  />
                }
                layout="inline"
                headerClassName="mobile-settings__label"
                className="mobile-settings__row"
                equalColumns
              >
                <Select
                  value={preference}
                  options={themeOptions}
                  appearance="bare"
                  size="large"
                  dropdownAlign="right"
                  ariaLabel={t("settings.theme")}
                  loading={themeStatus === "applying"}
                  error={themeStatus === "error"}
                  className="mobile-settings__theme min-w-0"
                  selectorClassName="justify-end [&_.select-value]:text-right"
                  style={SECTION_CONTROL_STYLE}
                  onChange={(value) => {
                    setPreference(String(value) as GlobalThemePreference).catch(
                      (error) =>
                        logger.warn("Mobile theme preference failed", error)
                    );
                  }}
                />
              </SectionRow>
              {themeStatus === "error" ? (
                <p
                  role="alert"
                  className="mobile-type-caption px-3 pb-3 text-danger-6"
                >
                  {t("settings.themeChangeFailed")}
                </p>
              ) : null}
            </SectionContainer>
          </SectionContainer>
        </div>
      </div>
    </>
  );
}

SettingsTab.displayName = "SettingsTab";

function SettingsLabel({
  icon,
  text,
}: {
  icon: typeof LaptopIcon;
  text: string;
}) {
  return (
    <span className="mobile-settings__row-label">
      <span className="mobile-settings__icon">
        <HugeiconsIcon icon={icon} size={18} aria-hidden="true" />
      </span>
      <span>{text}</span>
    </span>
  );
}
