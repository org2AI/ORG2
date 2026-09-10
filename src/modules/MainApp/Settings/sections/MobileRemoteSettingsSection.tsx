import { useAtomValue } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  PERMISSION_TIER,
  type PairedDeviceInfo,
  type PairingInitOutput,
  type RelayStatus,
  mobileRemoteApi,
} from "@src/api/tauri/mobileRemote";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Message from "@src/components/Message";
import { Placeholder } from "@src/components/Placeholder";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import Switch from "@src/components/Switch";
import {
  MOBILE_REMOTE_RELAY_PRODUCTION_URL,
  type MobileRemoteRelayPreset,
  mobileRemoteRelayPresetUrl,
  resolveMobileRemoteRelayPreset,
} from "@src/config/mobileRemoteRelay";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { useOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import { useAsyncData } from "@src/hooks/async/useAsyncData";
import { useSetting } from "@src/hooks/settings/useSettings";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import MobileRemoteOutdoorPairingDetails from "./MobileRemoteOutdoorPairingDetails";
import PairedDeviceList from "./PairedDeviceList";
import {
  formatMobileRemoteRelayStatusMessage,
  generateMobileRemoteLanToken,
  isMobileRemoteRelayReady,
} from "./mobileRemoteSettingsHelpers";
import { suggestOutdoorPairingPhoneLabel } from "./pairedDeviceDisplay";

function formatDeviceTimestamp(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  return formatRelativeTime(ms, "short");
}

const MobileRemoteSettingsSection: React.FC = () => {
  const { t } = useTranslation(["settings", "navigation", "common"]);
  const cloudAuth = useAtomValue(org2CloudAuthAtom);
  const handleCloudSignIn = useOrg2CloudSignIn();
  const [enabled, setEnabled] = useSetting("mobileRemote.enabled");
  const [relayEnabled, setRelayEnabled] = useSetting(
    "mobileRemote.relayEnabled"
  );
  const [relayUrl, setRelayUrl] = useSetting("mobileRemote.relayUrl");
  const [lanToken, setLanToken] = useSetting("mobileRemote.lanToken");

  const [advanced, setAdvanced] = useState(false);
  const [developerOptions, setDeveloperOptions] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);
  const [fullAccess, setFullAccess] = useState(true);
  const [pairing, setPairing] = useState<PairingInitOutput | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingConfirming, setPairingConfirming] = useState(false);
  const pairingRequestIdRef = useRef(0);

  const handleEnabledChange = useCallback(
    (next: boolean) => {
      setEnabled(next);
      if (next && lanToken.trim().length === 0) {
        setLanToken(generateMobileRemoteLanToken());
      }
    },
    [lanToken, setEnabled, setLanToken]
  );

  const handleRelayEnabledChange = (next: boolean) => {
    if (next && !relayUrl.trim()) {
      setRelayUrl(MOBILE_REMOTE_RELAY_PRODUCTION_URL);
    }
    setRelayEnabled(next);
  };

  const activeRelayPreset = useMemo(
    () => resolveMobileRemoteRelayPreset(relayUrl),
    [relayUrl]
  );
  const cloudSignedIn = cloudAuth != null;
  const cloudSignedInIdentity =
    cloudAuth?.profile?.displayName ??
    cloudAuth?.profile?.primaryEmail ??
    cloudAuth?.userId ??
    "";

  const relayConfigured = isMobileRemoteRelayReady({
    relayUrl,
    cloudSignedIn,
  });
  const relayQueryKey = `${enabled}:${relayEnabled}:${relayUrl}:${cloudAuth?.userId ?? "signed-out"}`;
  const {
    data: relayStatus,
    loading: relayStatusLoading,
    error: relayStatusError,
    refresh: refreshRelayStatus,
  } = useAsyncData<RelayStatus | null, string>({
    key: relayQueryKey,
    initialData: null,
    enabled,
    query: async () => mobileRemoteApi.getRelayStatus(),
  });

  const handleReconnect = async () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setReconnecting(true);
    try {
      await mobileRemoteApi.notifyCloudAuthChanged();
      refreshRelayStatus();
    } catch (error) {
      Message.error({ content: String(error) });
    } finally {
      reconnectingRef.current = false;
      setReconnecting(false);
    }
  };
  const relayNeedsRetry =
    !relayStatus ||
    ["backoff", "config_error", "stopped"].includes(relayStatus.phase);

  const handleStartPairing = useCallback(async () => {
    const requestId = ++pairingRequestIdRef.current;
    setPairingLoading(true);
    try {
      const next = await mobileRemoteApi.pairInit({
        tier: fullAccess ? PERMISSION_TIER.FULL : PERMISSION_TIER.READ_ONLY,
        label: suggestOutdoorPairingPhoneLabel(),
        isPrimary: true,
      });
      if (requestId !== pairingRequestIdRef.current) return;
      setPairing(next);
    } catch (error) {
      if (requestId !== pairingRequestIdRef.current) return;
      Message.error({
        content: `${t("mobileRemote.pairingFailed")}: ${String(error)}`,
      });
    } finally {
      if (requestId === pairingRequestIdRef.current) {
        setPairingLoading(false);
      }
    }
  }, [fullAccess, t]);

  const handleRelayPresetChange = useCallback(
    (preset: MobileRemoteRelayPreset) => {
      setRelayUrl(mobileRemoteRelayPresetUrl(preset));
    },
    [setRelayUrl]
  );

  const relayStatusDescription = useMemo(() => {
    const formatted = formatMobileRemoteRelayStatusMessage(
      relayStatus?.message,
      cloudSignedIn,
      t
    );
    if (formatted) {
      return formatted;
    }
    if (!cloudSignedIn) {
      return t("mobileRemote.cloudLoginDescSignedOut");
    }
    return t("mobileRemote.relayEnabledDesc");
  }, [cloudSignedIn, relayStatus?.message, t]);

  useEffect(() => {
    pairingRequestIdRef.current += 1;
    setPairing(null);
    setPairingLoading(false);
  }, [cloudAuth?.userId, enabled, relayEnabled, relayUrl]);

  useEffect(
    () => () => {
      pairingRequestIdRef.current += 1;
    },
    []
  );

  const {
    data: devices,
    loading: devicesLoading,
    error: devicesError,
    refresh: refreshDevices,
  } = useAsyncData<PairedDeviceInfo[], string>({
    key: relayQueryKey,
    initialData: [],
    enabled: enabled && relayConfigured,
    query: async () => mobileRemoteApi.syncDevices(),
  });

  const handleConfirmPairing = useCallback(async () => {
    if (!pairing) return;
    setPairingConfirming(true);
    try {
      await mobileRemoteApi.pairComplete({
        pairingCode: pairing.pairingCode,
        tier: fullAccess ? PERMISSION_TIER.FULL : PERMISSION_TIER.READ_ONLY,
      });
      setPairing(null);
      Message.success({ content: t("mobileRemote.pairingConfirmed") });
      refreshDevices();
    } catch (error) {
      Message.error({ content: String(error) });
    } finally {
      setPairingConfirming(false);
    }
  }, [fullAccess, pairing, refreshDevices, t]);

  const handleRevokeDevice = useCallback(
    async (deviceId: string) => {
      try {
        await mobileRemoteApi.revokeDevice(deviceId);
        refreshDevices();
      } catch (error) {
        Message.error({ content: String(error) });
      }
    },
    [refreshDevices]
  );

  return (
    <SectionContainer>
      <SectionRow
        label={t("mobileRemote.enabled")}
        description={t("mobileRemote.enabledDesc")}
      >
        <Switch checked={enabled} onCheckedChange={handleEnabledChange} />
      </SectionRow>

      {enabled ? (
        <>
          <SectionRow
            label={t("mobileRemote.cloudLoginTitle")}
            description={
              cloudSignedIn
                ? t("mobileRemote.cloudLoginDescSignedIn", {
                    identity: cloudSignedInIdentity,
                  })
                : t("mobileRemote.cloudLoginDescSignedOut")
            }
            indent
          >
            {cloudSignedIn ? (
              <span className="text-sm text-text-2">
                {cloudSignedInIdentity}
              </span>
            ) : (
              <Button
                size="default"
                onClick={handleCloudSignIn}
                data-testid="mobile-remote-cloud-sign-in"
              >
                {t("navigation:cloud.signIn")}
              </Button>
            )}
          </SectionRow>

          <SectionRow
            label={t("mobileRemote.outdoorTitle")}
            description={t("mobileRemote.outdoorDesc")}
            indent
          >
            <Switch
              checked={relayEnabled}
              onCheckedChange={handleRelayEnabledChange}
            />
          </SectionRow>

          {relayEnabled ? (
            <>
              <SectionRow
                label={t("mobileRemote.relayStatus")}
                description={relayStatusError ?? relayStatusDescription}
                indent
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-2">
                    {relayStatusLoading
                      ? t("mobileRemote.relayStatus_connecting")
                      : t(
                          `mobileRemote.relayStatus_${relayStatus?.phase ?? "stopped"}`
                        )}
                  </span>
                  <Button
                    variant="tertiary"
                    appearance="ghost"
                    size="small"
                    disabled={relayStatusLoading || reconnecting}
                    loading={reconnecting}
                    onClick={
                      relayNeedsRetry
                        ? () => void handleReconnect()
                        : refreshRelayStatus
                    }
                  >
                    {t(
                      relayNeedsRetry
                        ? "mobileRemote.retryConnection"
                        : "common:actions.refresh"
                    )}
                  </Button>
                </div>
              </SectionRow>

              <SectionRow label={t("mobileRemote.advancedSettings")} indent>
                <Button
                  variant="tertiary"
                  appearance="ghost"
                  size="small"
                  aria-expanded={advanced}
                  aria-controls="mobile-remote-advanced"
                  data-testid="mobile-remote-advanced-toggle"
                  onClick={() => setAdvanced(!advanced)}
                >
                  {t(
                    advanced
                      ? "mobileRemote.hideAdvanced"
                      : "mobileRemote.showAdvanced"
                  )}
                </Button>
              </SectionRow>
              {advanced ? (
                <div id="mobile-remote-advanced">
                  <SectionRow
                    label={t("mobileRemote.relayUrl")}
                    description={t("mobileRemote.relayUrlDesc")}
                    layout="vertical"
                    indent
                  >
                    <div className="flex w-full flex-col items-start gap-2">
                      <Input
                        aria-label={t("mobileRemote.relayUrl")}
                        value={relayUrl}
                        onChange={setRelayUrl}
                        placeholder="wss://relay.example.com/v1/mobile/ws"
                        spellCheck={false}
                      />
                      <Button
                        variant="tertiary"
                        appearance="ghost"
                        size="small"
                        onClick={() =>
                          setRelayUrl(MOBILE_REMOTE_RELAY_PRODUCTION_URL)
                        }
                      >
                        {t("mobileRemote.restoreDefaultRelay")}
                      </Button>
                      <Button
                        variant="tertiary"
                        appearance="ghost"
                        size="small"
                        aria-expanded={developerOptions}
                        onClick={() => setDeveloperOptions(!developerOptions)}
                      >
                        {t("mobileRemote.developerOptions")}
                      </Button>
                      {developerOptions ? (
                        <SegmentedTextPill
                          ariaLabel={t("mobileRemote.relayPresetAria")}
                          dataTestId="mobile-remote-relay-preset"
                          size="small"
                          value={activeRelayPreset}
                          options={[
                            {
                              value: "local",
                              label: t("mobileRemote.relayPresetLocal"),
                            },
                            {
                              value: "production",
                              label: t("mobileRemote.relayPresetProduction"),
                            },
                          ]}
                          onChange={handleRelayPresetChange}
                        />
                      ) : null}
                    </div>
                  </SectionRow>
                </div>
              ) : null}

              <SectionRow
                label={t("mobileRemote.fullAccess")}
                description={t("mobileRemote.fullAccessDesc")}
                indent
              >
                <Switch checked={fullAccess} onCheckedChange={setFullAccess} />
              </SectionRow>

              <SectionRow
                label={t("mobileRemote.pairing")}
                description={t("mobileRemote.sasDesktopHint")}
                layout="vertical"
                indent
              >
                {!pairing ? (
                  <Button
                    variant="primary"
                    loading={pairingLoading}
                    disabled={!relayConfigured || pairingLoading}
                    onClick={() => void handleStartPairing()}
                  >
                    {t("mobileRemote.startOutdoorPairing")}
                  </Button>
                ) : (
                  <MobileRemoteOutdoorPairingDetails
                    pairing={pairing}
                    confirming={pairingConfirming}
                    regenerating={pairingLoading}
                    onConfirm={() => void handleConfirmPairing()}
                    onRegenerate={() => void handleStartPairing()}
                  />
                )}
              </SectionRow>

              <SectionRow
                label={t("mobileRemote.pairedDevices")}
                description={t("mobileRemote.pairedDevicesDesc")}
                layout="vertical"
                indent
              >
                {devicesLoading ? (
                  <Placeholder variant="loading" placement="sidebar" />
                ) : devicesError ? (
                  <Placeholder
                    variant="error"
                    placement="sidebar"
                    title={t("mobileRemote.devicesLoadFailed")}
                    subtitle={devicesError}
                    onRetry={refreshDevices}
                  />
                ) : devices.length === 0 ? (
                  <Placeholder
                    variant="empty"
                    placement="sidebar"
                    title={t("mobileRemote.noDevices")}
                    subtitle={t("mobileRemote.noDevicesDesc")}
                  />
                ) : (
                  <PairedDeviceList
                    devices={devices}
                    formatTimestamp={formatDeviceTimestamp}
                    onRevoke={(deviceId) => void handleRevokeDevice(deviceId)}
                  />
                )}
              </SectionRow>
            </>
          ) : null}
        </>
      ) : null}
    </SectionContainer>
  );
};

export default MobileRemoteSettingsSection;
