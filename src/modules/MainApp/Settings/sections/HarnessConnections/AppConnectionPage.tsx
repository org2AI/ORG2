import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import { RpcError } from "@src/api/tauri/rpc/invoke";
import type { ConnectionHarness } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import {
  SECTION_DESCRIPTION_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import {
  configureExternalMarketCatalog,
  isMarketManagedView,
  modelsForExternalTarget,
  restoreExternalMarketTarget,
} from "@src/features/MarketConnect/externalAppBridge";
import { captureMarketOwner } from "@src/features/MarketConnect/identity";
import { openConfiguredMarketClient } from "@src/features/MarketConnect/launch";
import {
  type MarketExecutionProfile,
  useMarketExecutionProfiles,
} from "@src/features/MarketConnect/marketProfiles";
import { profilesForAppliedMarketSelection } from "@src/features/MarketConnect/marketSelection";

import ClaudeProfileEditor from "./ClaudeProfileEditor";
import ConnectionCards from "./ConnectionCards";
import HarnessConnectionEditor from "./HarnessConnectionEditor";
import {
  refreshHarnessConnections,
  useHarnessConnection,
} from "./useHarnessConnection";

type PickerStep = "closed" | "provider" | "market" | "accounts";

function profileLabel(
  profile: MarketExecutionProfile,
  profiles: MarketExecutionProfile[],
  suffix: (index: number, count: number) => string
) {
  const matches = profiles.filter((item) => item.label === profile.label);
  if (matches.length < 2) return profile.label;
  return `${profile.label} · ${suffix(
    matches.findIndex((item) => item.id === profile.id) + 1,
    matches.length
  )}`;
}

export default function AppConnectionPage({
  target,
  onConfigureAccounts,
  onDirtyChange,
}: {
  target: ConnectionHarness;
  onConfigureAccounts: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const {
    profiles,
    loading: profilesLoading,
    error: profilesError,
    refresh: refreshProfiles,
  } = useMarketExecutionProfiles({ enabled: true });
  const state = useHarnessConnection(target);
  const [picker, setPicker] = useState<PickerStep>("closed");
  const [busy, setBusy] = useState<"connect" | "open" | "restore" | null>(null);

  const [choosingProfiles, setChoosingProfiles] = useState<string[]>([]);
  const [choosingModel, setChoosingModel] = useState("");
  const marketProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) => modelsForExternalTarget(profile, target).length > 0
      ),
    [target, profiles]
  );
  const appliedMarketProfiles = profilesForAppliedMarketSelection(
    profiles,
    state.view?.config.selectedKeyId
  );
  const marketManaged = isMarketManagedView(state.view);
  const configured = Boolean(
    state.view && state.view.config.mode !== "default"
  );
  const accountName =
    state.view?.choices.find(
      (choice) => choice.keyId === state.view?.config.selectedKeyId
    )?.name ?? null;
  const activeMarketName = appliedMarketProfiles.length
    ? appliedMarketProfiles
        .map((profile) =>
          profileLabel(profile, marketProfiles, (index, count) =>
            t("harnessConnections.marketApps.workspaceNumber", { index, count })
          )
        )
        .join(" · ")
    : null;
  const selectedProfiles = marketProfiles.filter((profile) =>
    choosingProfiles.includes(profile.id)
  );
  const modelOptions = selectedProfiles.flatMap((profile) =>
    modelsForExternalTarget(profile, target).map((model) => ({
      value: JSON.stringify([profile.id, model]),
      label: `${profileLabel(profile, marketProfiles, (index, count) =>
        t("harnessConnections.marketApps.workspaceNumber", { index, count })
      )} · ${model}`,
    }))
  );
  const chosenValue = modelOptions.some(
    (option) => option.value === choosingModel
  )
    ? choosingModel
    : (modelOptions[0]?.value ?? "");
  const currentName = marketManaged
    ? (activeMarketName ??
      t(
        profilesLoading
          ? "harnessConnections.marketApps.loading"
          : profilesError
            ? "harnessConnections.marketApps.loadFailed"
            : "harnessConnections.missingKey"
      ))
    : (accountName ?? t("harnessConnections.original"));
  const issue =
    state.error ??
    state.view?.configurationIssue ??
    state.view?.config.message ??
    null;
  const unavailable = Boolean(
    !state.view?.installed ||
    !state.view?.config.supported ||
    state.view?.config.conflict ||
    state.error ||
    state.view?.configurationIssue
  );

  const refresh = async () => {
    refreshHarnessConnections();
    await state.reload();
  };
  const connectMarket = async () => {
    if (!chosenValue || !selectedProfiles.length) return;
    setBusy("connect");
    let owner: ReturnType<typeof captureMarketOwner> | undefined;
    try {
      owner = captureMarketOwner(
        selectedProfiles[0].connection.identity_user_id
      );
      const [defaultProfileId, defaultModel] = JSON.parse(chosenValue) as [
        string,
        string,
      ];
      await configureExternalMarketCatalog(
        selectedProfiles,
        target,
        defaultProfileId,
        defaultModel
      );
      owner.assertCurrent();
      setPicker("closed");
      await refresh();
      owner.assertCurrent();
      Message.success({
        content: t("harnessConnections.marketApps.connected"),
      });
    } catch (error) {
      // Allowlist the machine code; never display arbitrary native error text.
      const restoreRequired =
        error instanceof RpcError &&
        error.command === "market_connection_configure_catalog" &&
        error.cause === "native_app_restore_required";
      Message.error({
        content: t(
          restoreRequired
            ? "harnessConnections.marketApps.restoreRequired"
            : "harnessConnections.marketApps.actionFailed"
        ),
      });
    } finally {
      owner?.dispose();
      setBusy(null);
    }
  };
  const openClient = async () => {
    const selection = state.view?.config.selectedKeyId;
    const model = state.view?.config.selectedModel;
    if (!selection || !model) return;
    setBusy("open");
    let owner: ReturnType<typeof captureMarketOwner> | undefined;
    try {
      if (marketManaged) {
        const profile = appliedMarketProfiles[0];
        if (!profile) throw new Error("market_identity_mismatch");
        owner = captureMarketOwner(profile.connection.identity_user_id);
        await openConfiguredMarketClient(target, selection, model);
        owner.assertCurrent();
      } else if (target === "claude_code") {
        await rpc.agentOrgs.connections.openClient({
          agentName: target,
          keyId: selection,
          model,
        });
      } else {
        throw new Error("unsupported_client");
      }
      Message.success({
        content: t(
          target === "claude_code"
            ? "harnessConnections.marketApps.terminalOpened"
            : "harnessConnections.marketApps.opened"
        ),
      });
    } catch {
      Message.error({
        content: t("harnessConnections.marketApps.openFailed"),
      });
    } finally {
      owner?.dispose();
      setBusy(null);
    }
  };
  const restore = async () => {
    setBusy("restore");
    try {
      if (marketManaged) {
        await restoreExternalMarketTarget(target);
      } else {
        await rpc.agentOrgs.managedConfig.restoreDefault({
          agentName: target,
          force: false,
        });
      }
      await refresh();
      Message.success({
        content: t("harnessConnections.marketApps.disconnected"),
      });
    } catch {
      Message.error({
        content: t("harnessConnections.marketApps.actionFailed"),
      });
    } finally {
      setBusy(null);
    }
  };

  const status = state.loading
    ? t("harnessConnections.marketApps.checking")
    : !state.view?.installed
      ? t("harnessConnections.marketApps.notInstalled")
      : state.error
        ? t("harnessConnections.refreshFailed", { error: state.error })
        : state.view?.config.conflict
          ? t("harnessConnections.conflict")
          : !state.view?.config.supported || state.view.configurationIssue
            ? (state.view?.configurationIssue ??
              state.view?.config.message ??
              t("harnessConnections.marketApps.unavailable"))
            : configured && state.view?.config.overlay
              ? t("harnessConnections.overlayHelp", {
                  path: state.view.config.targetFiles[0]?.targetPath ?? "",
                })
              : marketManaged
                ? t("harnessConnections.proxyHelp")
                : configured
                  ? t("harnessConnections.applied")
                  : t("harnessConnections.marketApps.original");

  return (
    <div className="flex flex-col gap-4" data-testid={`app-page-${target}`}>
      <SectionContainer title={t("harnessConnections.current")}>
        <SectionRow showHeader={false}>
          <div className="flex w-full flex-col gap-1">
            <span
              className="truncate text-base font-medium text-text-1"
              title={currentName}
            >
              {currentName}
            </span>
            {configured && (
              <span className="text-xs text-text-2">
                {t(
                  marketManaged
                    ? "harnessConnections.marketApps.provider"
                    : "harnessConnections.connection"
                )}
              </span>
            )}
            <span className={SECTION_DESCRIPTION_CLASSES}>{status}</span>
            {state.view?.config.nativeApp && (
              <span className={SECTION_DESCRIPTION_CLASSES}>
                {t(
                  target === "claude_desktop"
                    ? "harnessConnections.marketApps.isolatedClaudeStorage"
                    : "harnessConnections.marketApps.isolatedStorage"
                )}
              </span>
            )}
            {issue && <span className="text-sm text-warning-6">{issue}</span>}
          </div>
        </SectionRow>
        <SectionRow showHeader={false}>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null || state.loading}
              onClick={() =>
                setPicker((value) =>
                  value === "closed" ? "provider" : "closed"
                )
              }
            >
              {t(
                configured ? "common:actions.edit" : "common:actions.configure"
              )}
            </Button>
            {(marketManaged ||
              (target === "claude_code" &&
                configured &&
                state.view?.config.overlay)) && (
              <Button
                loading={busy === "open"}
                disabled={
                  busy !== null ||
                  unavailable ||
                  (marketManaged && appliedMarketProfiles.length === 0)
                }
                onClick={() => void openClient()}
              >
                {t(
                  target === "claude_code"
                    ? "harnessConnections.marketApps.openTerminal"
                    : "harnessConnections.marketApps.open"
                )}
              </Button>
            )}
            {configured && (
              <Button
                loading={busy === "restore"}
                disabled={
                  busy !== null ||
                  state.loading ||
                  Boolean(state.error) ||
                  Boolean(state.view?.config.conflict)
                }
                onClick={() => void restore()}
              >
                {t(
                  state.view?.config.overlay
                    ? "harnessConnections.disconnect"
                    : "harnessConnections.restore"
                )}
              </Button>
            )}
          </div>
        </SectionRow>
      </SectionContainer>

      {picker !== "closed" && (
        <SectionContainer
          title={t(
            picker === "provider"
              ? "common:labels.provider"
              : "harnessConnections.connection"
          )}
          dataTestId="connection-picker"
        >
          {picker !== "provider" && (
            <SectionRow showHeader={false}>
              <Button
                variant="tertiary"
                size="small"
                onClick={() => setPicker("provider")}
              >
                {t("common:actions.back")}
              </Button>
            </SectionRow>
          )}
          {picker === "provider" && (
            <SectionRow showHeader={false}>
              <ConnectionCards
                choices={[
                  {
                    keyId: "market",
                    name: t("harnessConnections.marketApps.provider"),
                    models: [],
                    endpoint: null,
                    requiresTest: false,
                    reason: null,
                  },
                  {
                    keyId: "accounts",
                    name: t("harnessConnections.connection"),
                    models: [],
                    endpoint: null,
                    requiresTest: false,
                    reason: null,
                  },
                ]}
                selected=""
                active={null}
                disabled={busy !== null}
                description={(id) =>
                  t(
                    id === "market"
                      ? "harnessConnections.marketApps.workspaceHelp"
                      : "harnessConnections.empty"
                  )
                }
                onSelect={(id) => {
                  if (id === "market")
                    setChoosingProfiles(
                      appliedMarketProfiles.map((profile) => profile.id)
                    );
                  setPicker(id === "market" ? "market" : "accounts");
                }}
              />
            </SectionRow>
          )}
          {picker === "market" && (
            <SectionRow showHeader={false}>
              <div className="flex w-full flex-col gap-2">
                <p className={SECTION_DESCRIPTION_CLASSES}>
                  {t("harnessConnections.marketApps.multiPackageHelp")}
                </p>
                {target === "claude_code" && (
                  <p className={SECTION_DESCRIPTION_CLASSES}>
                    {t("harnessConnections.marketApps.auxiliaryBilling")}
                  </p>
                )}
                {profilesLoading ? (
                  <p className={SECTION_DESCRIPTION_CLASSES}>
                    {t("harnessConnections.marketApps.loading")}
                  </p>
                ) : profilesError ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-warning-6">
                      {t("harnessConnections.marketApps.loadFailed")}
                    </p>
                    <Button onClick={() => void refreshProfiles()}>
                      {t("harnessConnections.refresh")}
                    </Button>
                  </div>
                ) : marketProfiles.length === 0 ? (
                  <p className={SECTION_DESCRIPTION_CLASSES}>
                    {t("harnessConnections.marketApps.nonePurchased")}
                  </p>
                ) : (
                  <ConnectionCards
                    choices={marketProfiles.map((profile) => ({
                      keyId: profile.id,
                      name: profileLabel(
                        profile,
                        marketProfiles,
                        (index, count) =>
                          t("harnessConnections.marketApps.workspaceNumber", {
                            index,
                            count,
                          })
                      ),
                      models: modelsForExternalTarget(profile, target),
                      endpoint: null,
                      requiresTest: false,
                      reason:
                        choosingProfiles.length >= 8 &&
                        !choosingProfiles.includes(profile.id)
                          ? t("harnessConnections.marketApps.packageLimit")
                          : null,
                    }))}
                    selected={choosingProfiles}
                    active={appliedMarketProfiles.map((profile) => profile.id)}
                    disabled={busy !== null || unavailable}
                    description={(id) =>
                      `${modelsForExternalTarget(marketProfiles.find((profile) => profile.id === id)!, target).length} · ${t("harnessConnections.model")}`
                    }
                    onSelect={(id) =>
                      setChoosingProfiles((selected) =>
                        selected.includes(id)
                          ? selected.filter((entry) => entry !== id)
                          : selected.length < 8
                            ? [...selected, id]
                            : selected
                      )
                    }
                  />
                )}
              </div>
            </SectionRow>
          )}
          {picker === "market" && selectedProfiles.length > 0 && (
            <SectionRow showHeader={false}>
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={chosenValue}
                  onChange={(value) => setChoosingModel(String(value))}
                  options={modelOptions}
                  ariaLabel={t("harnessConnections.marketApps.defaultModel")}
                />
                <Button
                  disabled={!chosenValue || busy !== null || unavailable}
                  onClick={() => void connectMarket()}
                >
                  {t("harnessConnections.apply")}
                </Button>
              </div>
            </SectionRow>
          )}
          {picker === "accounts" && (
            <SectionRow showHeader={false}>
              <div className="flex w-full flex-col gap-2">
                {target === "codex" ? (
                  <HarnessConnectionEditor
                    agentName={target}
                    onAdd={onConfigureAccounts}
                  />
                ) : (
                  <ClaudeProfileEditor
                    target={target}
                    onDirtyChange={onDirtyChange}
                    onAdd={onConfigureAccounts}
                  />
                )}
              </div>
            </SectionRow>
          )}
        </SectionContainer>
      )}
    </div>
  );
}
