import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";
import { Placeholder } from "@src/components/Placeholder";
import StatusDot from "@src/components/StatusDot";
import { SectionContainer, SectionRow } from "@src/components/layout/Section";
import {
  Add01Icon,
  HugeiconsIcon,
  LaptopIcon,
  SmartPhone01Icon,
} from "@src/icons";

import { useMobileRemote } from "../../app";
import { MobileConnectionNotice } from "../../components/MobileConnectionNotice";
import { MobileTopBar } from "../../components/MobileTopBar";
import { derivePairedDesktopPresence } from "../../connection/mobilePairedDesktopPresence";
import { resolvePermissionTierLabel } from "../../connection/mobilePermissionPresentation";
import type { DesktopPresence } from "../../connection/types";
import "./mobileConnections.scss";

function resolveDotColor(presence: DesktopPresence): string {
  switch (presence) {
    case "online":
      return "bg-success-6";
    case "offline":
      return "bg-text-4";
    default:
      return "bg-text-4";
  }
}

function resolvePresenceLabel(
  presence: DesktopPresence,
  t: (key: string) => string
): string {
  switch (presence) {
    case "online":
      return t("devices.online");
    case "offline":
      return t("devices.offline");
    default:
      return t("devices.unknown");
  }
}

/** Settings destination; the provider remains the owner of device selection. */
export function ConnectionDevicesScreen({
  onBack,
  onAddDesktop,
}: {
  onBack: () => void;
  onAddDesktop: () => void;
}) {
  const { t } = useTranslation("mobileRemote");
  const [switchingDesktopId, setSwitchingDesktopId] = React.useState<
    string | null
  >(null);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  const {
    connection,
    retryConnection,
    pairedDesktops: pairedDesktopInventory,
    switchPairedDesktop,
  } = useMobileRemote();
  const pairedDesktops = derivePairedDesktopPresence({
    desktops: pairedDesktopInventory,
    activePresence: connection.presence,
  });

  return (
    <>
      <MobileTopBar
        title={t("settings.connectionDevices")}
        onBack={onBack}
        backAriaLabel={t("settings.back")}
      />
      <div className="mobile-flow-screen mobile-connections flex-1">
        <MobileConnectionNotice
          connection={connection}
          onRetry={retryConnection}
          className="mb-4"
        />
        <section className="mobile-connections__group">
          <h2 className="mobile-connections__heading">
            {t("devices.thisDevice")}
          </h2>
          <SectionContainer
            className="mobile-connections__card"
            dataTestId="mobile-remote-this-device"
          >
            <SectionRow
              showHeader={false}
              compact
              className="mobile-connections__section-row"
            >
              <div className="mobile-connections__row">
                <span className="mobile-connections__icon" aria-hidden="true">
                  <HugeiconsIcon icon={SmartPhone01Icon} size={20} />
                </span>
                <div className="mobile-connections__line">
                  <span className="mobile-connections__name">
                    {t("devices.thisDeviceLabel")}
                  </span>
                  <span className="mobile-connections__permission">
                    {resolvePermissionTierLabel(connection.tier, t)}
                  </span>
                </div>
              </div>
            </SectionRow>
          </SectionContainer>
        </section>

        <section className="mobile-connections__group">
          <h2 className="mobile-connections__heading">
            {t("devices.pairedDesktops")}
          </h2>
          <SectionContainer
            className="mobile-connections__card"
            dataTestId="mobile-remote-paired-desktops"
          >
            {pairedDesktops.length === 0 ? (
              <Placeholder
                titleClassName="mobile-type-heading"
                subtitleClassName="mobile-type-secondary"
                variant="empty"
                title={t("devices.emptyDesktops")}
                className="py-6"
              />
            ) : (
              pairedDesktops.map((desktop) => {
                const icon = (
                  <span className="mobile-connections__icon" aria-hidden="true">
                    <HugeiconsIcon icon={LaptopIcon} size={20} />
                  </span>
                );
                const content = (
                  <div className="mobile-connections__identity">
                    <div className="mobile-connections__line">
                      <span
                        className="mobile-connections__name"
                        title={desktop.name}
                      >
                        {desktop.name}
                      </span>
                      {desktop.current ? (
                        <span className="mobile-connections__current">
                          {t("devices.currentDesktop")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mobile-connections__line">
                      {desktop.details ? (
                        <span
                          className="mobile-connections__details"
                          title={desktop.details}
                        >
                          {desktop.details}
                        </span>
                      ) : null}
                      <StatusDot
                        color={resolveDotColor(desktop.presence)}
                        label={
                          desktop.current
                            ? resolvePresenceLabel(desktop.presence, t)
                            : t("devices.presenceUnknown")
                        }
                        size="inline"
                        className="mobile-connections__presence"
                        labelClassName="mobile-type-caption text-text-3"
                      />
                    </div>
                  </div>
                );
                return (
                  <SectionRow
                    key={desktop.id}
                    showHeader={false}
                    compact
                    className="mobile-connections__section-row"
                  >
                    {desktop.current ? (
                      <div
                        aria-current="true"
                        className="mobile-connections__row"
                      >
                        {icon}
                        {content}
                      </div>
                    ) : (
                      // Compound device row owns the identity/status layout and full-row hit target.
                      <Button
                        layout="custom"
                        className="mobile-connections__row mobile-connections__switch"
                        disabled={switchingDesktopId !== null}
                        loading={switchingDesktopId === desktop.id}
                        aria-busy={switchingDesktopId === desktop.id}
                        aria-label={t("devices.switchTo", {
                          name: desktop.name,
                        })}
                        icon={icon}
                        onClick={() => {
                          setSwitchError(null);
                          setSwitchingDesktopId(desktop.id);
                          switchPairedDesktop(desktop.id).then(
                            () => setSwitchingDesktopId(null),
                            () => {
                              setSwitchError(t("devices.switchFailed"));
                              setSwitchingDesktopId(null);
                            }
                          );
                        }}
                      >
                        {content}
                      </Button>
                    )}
                  </SectionRow>
                );
              })
            )}
            {switchError ? (
              <SectionRow showHeader={false} compact>
                <PageNotice
                  bodyClassName="mobile-type-secondary"
                  type="danger"
                  role="alert"
                  compact
                  className="w-full"
                >
                  {switchError}
                </PageNotice>
              </SectionRow>
            ) : null}
            <SectionRow
              showHeader={false}
              compact
              className="mobile-connections__section-row"
            >
              <Button
                variant="tertiary"
                size="large"
                long
                className="mobile-connections__add"
                icon={<HugeiconsIcon icon={Add01Icon} size={18} />}
                disabled={switchingDesktopId !== null}
                onClick={onAddDesktop}
              >
                {t("devices.addDesktop")}
              </Button>
            </SectionRow>
          </SectionContainer>
        </section>
      </div>
    </>
  );
}

ConnectionDevicesScreen.displayName = "ConnectionDevicesScreen";
