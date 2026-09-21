import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type PairedDeviceInfo,
  mobileRemoteApi,
} from "@src/api/tauri/mobileRemote";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Message from "@src/components/Message";
import { Placeholder } from "@src/components/Placeholder";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import Switch from "@src/components/Switch";
import {
  SECTION_ACTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import {
  MOBILE_REMOTE_RELAY_PRODUCTION_URL,
  type MobileRemoteRelayPreset,
  mobileRemoteRelayPresetUrl,
  resolveMobileRemoteRelayPreset,
} from "@src/config/mobileRemoteRelay";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { useOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import { useAsyncData } from "@src/hooks/async/useAsyncData";
import { useSetting } from "@src/hooks/settings/useSettings";
import { HugeiconsIcon, Refresh04Icon } from "@src/icons";
import { saveSettingsBatchAtom } from "@src/store/settings/settingsAtom";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import MobileRemotePairingFlow from "./MobileRemotePairingFlow";
import PairedDeviceList from "./PairedDeviceList";
import {
  formatMobileRemoteRelayStatusMessage,
  generateMobileRemoteLanToken,
  isMobileRemoteRelayReady,
} from "./mobileRemoteSettingsHelpers";
import { useMobileRelayStatus } from "./useMobileRelayStatus";

function formatDeviceTimestamp(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  return formatRelativeTime(ms, "short");
}

const MobileRemoteSettingsSection: React.FC = () => {
  const { t } = useTranslation(["settings", "navigation", "common"]);
  const cloudAuth = useAtomValue(org2CloudAuthAtom);
  const handleCloudSignIn = useOrg2CloudSignIn();
  const [enabled] = useSetting("mobileRemote.enabled");
  const saveSettings = useSetAtom(saveSettingsBatchAtom);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const savingEnabledRef = useRef(false);
  const [relayEnabled, setRelayEnabled] = useSetting(
    "mobileRemote.relayEnabled"
  );
  const [relayUrl, setRelayUrl] = useSetting("mobileRemote.relayUrl");
  const [lanToken] = useSetting("mobileRemote.lanToken");

  const [developerOptions, setDeveloperOptions] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);

  const handleEnabledChange = useCallback(
    async (next: boolean) => {
      if (savingEnabledRef.current) return;
      savingEnabledRef.current = true;
      setSavingEnabled(true);
      try {
        await saveSettings(
          next
            ? {
                "mobileRemote.enabled": true,
                "mobileRemote.relayEnabled": true,
                "mobileRemote.relayUrl": relayUrl.trim()
                  ? relayUrl
                  : MOBILE_REMOTE_RELAY_PRODUCTION_URL,
                "mobileRemote.lanToken": lanToken.trim()
                  ? lanToken
                  : generateMobileRemoteLanToken(),
              }
            : { "mobileRemote.enabled": false }
        );
      } catch (error) {
        Message.error({ content: String(error) });
      } finally {
        savingEnabledRef.current = false;
        setSavingEnabled(false);
      }
    },
    [lanToken, relayUrl, saveSettings]
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
  const relayQueryKey = JSON.stringify([
    enabled,
    relayEnabled,
    relayUrl,
    cloudAuth ? org2CloudAuthIdentityKey(cloudAuth) : null,
  ]);
  const {
    data: relayStatus,
    loading: relayStatusLoading,
    error: relayStatusError,
    refresh: refreshRelayStatus,
    manualRefreshRequired,
  } = useMobileRelayStatus(relayQueryKey, enabled);

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
    ["backoff", "config_error", "stopped", "connecting"].includes(
      relayStatus.phase
    );

  const handleRelayPresetChange = useCallback(
    (preset: MobileRemoteRelayPreset) => {
      setRelayUrl(mobileRemoteRelayPresetUrl(preset));
    },
    [setRelayUrl]
  );

  const relayStatusDescription = !relayEnabled
    ? t("mobileRemote.relayDisabledHint")
    : (relayStatusError ??
      (relayNeedsRetry
        ? formatMobileRemoteRelayStatusMessage(
            relayStatus?.message,
            cloudSignedIn,
            t
          )
        : null));
  const showRelayRecovery =
    relayNeedsRetry || Boolean(relayStatusError) || manualRefreshRequired;

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
    <>
      <SectionContainer>
        <SectionRow
          label={t("mobileRemote.enabled")}
          description={
            (enabled && relayStatusDescription) || t("mobileRemote.enabledDesc")
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            {enabled && relayEnabled && cloudSignedIn ? (
              <span
                className="text-sm text-text-2"
                role="status"
                aria-label={t("mobileRemote.relayStatus")}
              >
                {relayStatusLoading && !relayStatus
                  ? t("mobileRemote.relayStatus_connecting")
                  : t(
                      `mobileRemote.relayStatus_${relayStatus?.phase ?? "stopped"}`
                    )}
              </span>
            ) : null}
            <div className={SECTION_ACTION_GAP_CLASSES}>
              <Switch
                checked={enabled}
                disabled={savingEnabled}
                ariaLabel={t("mobileRemote.enabled")}
                onCheckedChange={(next) => {
                  void handleEnabledChange(next).catch((error: unknown) => {
                    Message.error({ content: String(error) });
                  });
                }}
              />
              {enabled && relayEnabled && cloudSignedIn && showRelayRecovery ? (
                <Button
                  iconOnly
                  icon={
                    <HugeiconsIcon
                      icon={Refresh04Icon}
                      data-icon="refresh-cw"
                      size={14}
                    />
                  }
                  aria-label={t(
                    relayNeedsRetry
                      ? "mobileRemote.retryConnection"
                      : "common:actions.refresh"
                  )}
                  disabled={relayStatusLoading || reconnecting}
                  loading={reconnecting}
                  onClick={
                    relayNeedsRetry
                      ? () => void handleReconnect()
                      : refreshRelayStatus
                  }
                />
              ) : null}
            </div>
          </div>
        </SectionRow>

        {enabled ? (
          <>
            <SectionRow
              label={t("mobileRemote.cloudLoginTitle")}
              description={
                cloudSignedIn
                  ? undefined
                  : t("mobileRemote.cloudLoginDescSignedOut")
              }
              indent
            >
              {cloudSignedIn ? (
                <span className="text-sm break-words text-text-3">
                  {t("mobileRemote.cloudLoginDescSignedIn", {
                    identity: cloudSignedInIdentity,
                  })}
                </span>
              ) : (
                <Button
                  onClick={() => {
                    void handleCloudSignIn().catch(() => undefined);
                  }}
                  data-testid="mobile-remote-cloud-sign-in"
                >
                  {t("navigation:cloud.signIn")}
                </Button>
              )}
            </SectionRow>

            <MobileRemotePairingFlow
              key={relayQueryKey}
              available={relayEnabled && relayConfigured}
              onPaired={refreshDevices}
            />

            {relayConfigured ? (
              <SectionRow
                label={t("mobileRemote.pairedDevices")}
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
            ) : null}
          </>
        ) : null}
      </SectionContainer>

      {enabled ? (
        <SectionContainer
          title={t("mobileRemote.advancedSettings")}
          collapsible
          defaultOpen={false}
          titleButtonTestId="mobile-remote-advanced-toggle"
        >
          <SectionRow
            label={t("mobileRemote.outdoorTitle")}
            description={t("mobileRemote.outdoorDesc")}
          >
            <Switch
              checked={relayEnabled}
              ariaLabel={t("mobileRemote.outdoorTitle")}
              onCheckedChange={handleRelayEnabledChange}
            />
          </SectionRow>
          <SectionRow
            label={t("mobileRemote.relayUrl")}
            description={t("mobileRemote.relayUrlDesc")}
            layout="vertical"
          >
            <Input
              aria-label={t("mobileRemote.relayUrl")}
              value={relayUrl}
              onChange={setRelayUrl}
              placeholder="wss://relay.example.com/v1/mobile/ws"
              spellCheck={false}
            />
          </SectionRow>
          <SectionRow
            showHeader={false}
            className="flex justify-end"
            dataTestId="mobile-remote-relay-actions"
          >
            <div
              className={`${SECTION_ACTION_GAP_CLASSES} flex-wrap justify-end`}
            >
              <Button
                size="small"
                onClick={() => setRelayUrl(MOBILE_REMOTE_RELAY_PRODUCTION_URL)}
              >
                {t("mobileRemote.restoreDefaultRelay")}
              </Button>
              <Button
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
        </SectionContainer>
      ) : null}
    </>
  );
};

export default MobileRemoteSettingsSection;
