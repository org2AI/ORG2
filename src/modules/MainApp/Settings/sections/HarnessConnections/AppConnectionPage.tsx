import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import { RpcError } from "@src/api/tauri/rpc/invoke";
import type { ConnectionHarness } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import RefreshButton from "@src/components/Button/RefreshButton";
import Message from "@src/components/Message";
import ModelIcon from "@src/components/ModelIcon";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_CONTROL_STYLE,
  SECTION_DESCRIPTION_CLASSES,
  SectionContainer,
  SectionProfileSwitcher,
  SectionRow,
} from "@src/components/layout/Section";
import { HintWithInfo } from "@src/components/layout/blocks/HintWithInfo";
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
import { createLogger } from "@src/hooks/logger";
import { HugeiconsIcon, Link01Icon, Store01Icon } from "@src/icons";
import { SelectionGrid } from "@src/scaffold/WizardSystem/primitives";

import ClaudeProfileEditor from "./ClaudeProfileEditor";
import HarnessConnectionEditor from "./HarnessConnectionEditor";
import {
  refreshHarnessConnections,
  useHarnessConnection,
} from "./useHarnessConnection";

/**
 * Where this app's requests go, as one flat list: the app's own configuration,
 * ORG2 Market, and each saved custom connection. "default" is a real choice
 * rather than the absence of one, so the applied provider is always visible.
 * A custom connection is addressed as `profile:<id>`; "new" is an unsaved one.
 */
const log = createLogger("AppConnectionPage");

type Provider = "default" | "market" | "accounts" | "new" | `profile:${string}`;

const PROFILE_PREFIX = "profile:";

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
  onDirtyChange,
}: {
  target: ConnectionHarness;
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
  const [chosenProvider, setChosenProvider] = useState<Provider | null>(null);
  // An unsaved connection owns the list: selecting another provider would
  // overwrite the draft, so the other options stay disabled until it settles.
  const [editorDirty, setEditorDirty] = useState(false);
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
  const connectionProfiles = state.view?.profiles ?? [];
  const appliedProfileId = state.view?.appliedProfile?.id ?? null;
  const appliedProvider: Provider = marketManaged
    ? "market"
    : appliedProfileId
      ? `${PROFILE_PREFIX}${appliedProfileId}`
      : configured
        ? "accounts"
        : "default";
  // An explicit pick wins until it is applied; then the applied one takes over.
  const picker = chosenProvider ?? appliedProvider;
  const lockedTo = (provider: Provider) => editorDirty && provider !== picker;
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
  const issue =
    state.error ??
    state.view?.configurationIssue ??
    state.view?.config.message ??
    null;
  const historySync = target === "codex" ? state.view?.historySync : null;
  const historySyncText = historySync
    ? historySync.state === "paused"
      ? t("harnessConnections.marketApps.historySync.paused", {
          reason: historySync.reason ?? "",
        })
      : historySync.state === "active"
        ? historySync.conflicts > 0
          ? t("harnessConnections.marketApps.historySync.attention", {
              shared: historySync.shared,
              conflicts: historySync.conflicts,
            })
          : t("harnessConnections.marketApps.historySync.active", {
              shared: historySync.shared,
            })
        : t("harnessConnections.marketApps.historySync.idle")
    : null;
  const unavailable = Boolean(
    !state.view?.installed ||
    !state.view?.config.supported ||
    state.view?.config.conflict ||
    state.error ||
    state.view?.configurationIssue
  );

  /**
   * Both actions report their own failures through Message and settle before
   * returning, so nothing here awaits them — but a floating promise would
   * swallow a rejection, so the handler logs instead.
   */
  const runAction = (action: () => Promise<void>) => {
    action().catch((error: unknown) => {
      log.error("connection action failed:", error);
    });
  };
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
      setChosenProvider(null);
      await refresh();
      owner.assertCurrent();
      Message.success({
        content: t("harnessConnections.marketApps.connected"),
      });
    } catch (error) {
      // Allowlist the machine code; never display arbitrary native error text.
      const code =
        error instanceof RpcError &&
        error.command === "market_connection_configure_catalog"
          ? error.cause
          : null;
      Message.error({
        content: t(
          code === "native_app_restore_required"
            ? "harnessConnections.marketApps.restoreRequired"
            : code === "native_app_version_unverified"
              ? "harnessConnections.marketApps.versionUnverified"
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
    setChosenProvider(null);
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
    } catch (error) {
      // Match only this command's known conflict; native errors may contain secrets.
      const configurationChanged =
        error instanceof RpcError &&
        error.command === "cli_config_restore_default" &&
        error.cause ===
          "Current CLI config was modified outside ORG2. Force restore to overwrite it.";
      Message.error({
        content: t(
          configurationChanged
            ? "harnessConnections.conflict"
            : "harnessConnections.marketApps.actionFailed"
        ),
      });
      await refresh();
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

  const providerItems = [
    {
      id: "default",
      label: t("harnessConnections.original"),
      // The app's own setup wears the app's own icon.
      leading: <ModelIcon agentType={target} size="small" />,
      disabled: lockedTo("default"),
      dataTestId: "app-provider-default",
    },
    {
      id: "market",
      // Name the applied packages here; nothing else in this list can.
      label:
        appliedProvider === "market" && activeMarketName
          ? `${t("harnessConnections.marketApps.provider")} · ${activeMarketName}`
          : t("harnessConnections.marketApps.provider"),
      leading: <HugeiconsIcon icon={Store01Icon} data-icon="store" size={16} />,
      disabled: lockedTo("market"),
      dataTestId: "app-provider-market",
    },
    ...(target === "codex"
      ? [
          {
            id: "accounts",
            label:
              appliedProvider === "accounts" && accountName
                ? `${t("harnessConnections.connection")} · ${accountName}`
                : t("harnessConnections.connection"),
            leading: (
              <HugeiconsIcon icon={Link01Icon} data-icon="link" size={16} />
            ),
            disabled: lockedTo("accounts"),
            dataTestId: "app-provider-accounts",
          },
        ]
      : connectionProfiles.map((profile) => {
          const id = `${PROFILE_PREFIX}${profile.id}`;
          return {
            id,
            label: profile.name,
            leading: (
              <HugeiconsIcon icon={Link01Icon} data-icon="link" size={16} />
            ),
            // Applied, but with saved edits not yet applied, is its own state —
            // the check alone would hide that.
            badge:
              appliedProfileId === profile.id &&
              state.view?.appliedProfile?.revision !== profile.revision
                ? t("claudeProfiles.updatePending")
                : undefined,
            disabled: lockedTo(id as Provider),
            dataTestId: `app-provider-${profile.id}`,
          };
        })),
  ];
  // An unsaved new connection has no row of its own yet; give it one so the
  // list still shows where you are.
  if (picker === "new")
    providerItems.push({
      id: "new",
      label: t("claudeProfiles.newName"),
      leading: <HugeiconsIcon icon={Link01Icon} data-icon="link" size={16} />,
      disabled: false,
      dataTestId: "app-provider-new",
    });

  const selectProvider = (provider: Provider) => {
    if (provider === "market")
      setChoosingProfiles(appliedMarketProfiles.map((profile) => profile.id));
    setChosenProvider(provider);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* What the app runs on right now, and the picker for what to set up
          next. Picking here only moves the selection below — applying stays
          the explicit action in each provider's own form. */}
      <SectionContainer>
        <SectionRow
          label={t("harnessConnections.current")}
          description={status}
        >
          <div className={`${SECTION_ACTION_GAP_CLASSES} flex-wrap`}>
            {/* Bound to what is applied, never to the sidebar: browsing the
                list on the left must not make this claim the app moved. */}
            <Select
              ariaLabel={t("common:labels.provider")}
              value={appliedProvider}
              disabled={editorDirty || state.loading || busy !== null}
              style={SECTION_CONTROL_STYLE}
              options={providerItems.map((item) => ({
                value: item.id,
                label: item.label,
                icon: item.leading,
              }))}
              onChange={(value) => {
                const next = String(value) as Provider;
                // Preview it either way; hand back the app's own setup right
                // away, since that is the one switch this row can throw with
                // nothing else selected. Everything else is applied by the
                // "use this connection" switch once it is ready.
                selectProvider(next);
                if (next === "default" && configured) runAction(restore);
              }}
            />
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
      <SectionProfileSwitcher
        dataTestId={`app-page-${target}`}
        items={providerItems}
        selectedId={picker}
        onSelect={(id) => selectProvider(id as Provider)}
        add={
          target === "codex"
            ? undefined
            : {
                label: t("claudeProfiles.new"),
                disabled: lockedTo("new"),
                onClick: () => setChosenProvider("new"),
                dataTestId: "app-provider-add",
              }
        }
        refresh={{
          label: t("harnessConnections.refresh"),
          onRefresh: refresh,
          refreshing: state.loading,
          dataTestId: "app-provider-refresh",
        }}
      >
        {(picker === "default" || picker === "market") && (
          <SectionRow label={t("harnessConnections.apply")}>
            <Switch
              ariaLabel={t("harnessConnections.apply")}
              checked={picker === appliedProvider}
              disabled={
                busy !== null ||
                state.loading ||
                Boolean(state.view?.config.conflict) ||
                (picker === "default"
                  ? !configured
                  : unavailable || !chosenValue || !selectedProfiles.length)
              }
              onCheckedChange={(on) => {
                // Switching a provider on applies it; switching the applied one
                // off hands the app back its own configuration.
                runAction(
                  !on || picker === "default" ? restore : connectMarket
                );
              }}
            />
          </SectionRow>
        )}
        {state.view?.config.nativeApp && (
          <SectionRow showHeader={false}>
            <p className={SECTION_DESCRIPTION_CLASSES}>
              {t(
                target === "claude_desktop"
                  ? "harnessConnections.marketApps.isolatedClaudeStorage"
                  : "harnessConnections.marketApps.isolatedStorage"
              )}
            </p>
          </SectionRow>
        )}
        {state.view?.config.nativeApp && historySyncText && (
          <SectionRow showHeader={false}>
            <p
              className={
                historySync?.state === "paused"
                  ? "text-sm text-warning-6"
                  : SECTION_DESCRIPTION_CLASSES
              }
              data-testid="codex-history-sync-status"
            >
              {historySyncText}
            </p>
          </SectionRow>
        )}
        {issue && (
          <SectionRow showHeader={false}>
            <p role="alert" className="text-sm text-warning-6">
              {issue}
            </p>
          </SectionRow>
        )}
        {picker === "market" && (
          <SectionRow
            label={
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  {t("harnessConnections.connection")}
                  {target === "claude_code" && (
                    <HintWithInfo
                      content={t(
                        "harnessConnections.marketApps.auxiliaryBilling"
                      )}
                      position="right"
                    />
                  )}
                </span>
                <RefreshButton
                  iconOnly
                  variant="secondary"
                  label={t("harnessConnections.refresh")}
                  onRefresh={refreshProfiles}
                  refreshing={profilesLoading}
                  dataTestId="market-packages-refresh"
                />
              </span>
            }
            description={t("harnessConnections.marketApps.multiPackageHelp")}
            layout="vertical"
          >
            {profilesLoading ? (
              <p className={SECTION_DESCRIPTION_CLASSES}>
                {t("harnessConnections.marketApps.loading")}
              </p>
            ) : profilesError ? (
              <p className="text-sm text-warning-6">
                {t("harnessConnections.marketApps.loadFailed")}
              </p>
            ) : marketProfiles.length === 0 ? (
              <p className={SECTION_DESCRIPTION_CLASSES}>
                {t("harnessConnections.marketApps.nonePurchased")}
              </p>
            ) : (
              <SelectionGrid
                multiSelect
                vertical
                options={marketProfiles.map((profile) => {
                  const overLimit =
                    choosingProfiles.length >= 8 &&
                    !choosingProfiles.includes(profile.id);
                  return {
                    key: profile.id,
                    label: profileLabel(
                      profile,
                      marketProfiles,
                      (index, count) =>
                        t("harnessConnections.marketApps.workspaceNumber", {
                          index,
                          count,
                        })
                    ),
                    badge: appliedMarketProfiles.some(
                      (applied) => applied.id === profile.id
                    )
                      ? t("harnessConnections.current")
                      : undefined,
                    tooltip: overLimit
                      ? t("harnessConnections.marketApps.packageLimit")
                      : undefined,
                    disabled: busy !== null || unavailable || overLimit,
                  };
                })}
                selected={new Set(choosingProfiles)}
                cardVariant="subtle"
                onToggle={(id) =>
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
          </SectionRow>
        )}
        {picker === "market" && selectedProfiles.length > 0 && (
          <>
            <SectionRow label={t("harnessConnections.marketApps.defaultModel")}>
              <Select
                value={chosenValue}
                onChange={(value) => setChoosingModel(String(value))}
                options={modelOptions}
                style={SECTION_CONTROL_STYLE}
                ariaLabel={t("harnessConnections.marketApps.defaultModel")}
              />
            </SectionRow>
            <SectionRow showHeader={false}>
              <Button
                loading={busy === "connect"}
                disabled={!chosenValue || busy !== null || unavailable}
                onClick={() => void connectMarket()}
              >
                {t("harnessConnections.apply")}
              </Button>
            </SectionRow>
          </>
        )}
        {/* Codex has no saved profiles, so its editor stays a set of rows in
            this card; the Claude profiles bring their own switcher container
            below. */}
        {picker === "accounts" && target === "codex" && (
          <HarnessConnectionEditor agentName={target} />
        )}
        {target !== "codex" &&
          (picker === "new" || picker.startsWith(PROFILE_PREFIX)) && (
            <ClaudeProfileEditor
              target={target}
              profileId={
                picker === "new" ? null : picker.slice(PROFILE_PREFIX.length)
              }
              onDiscarded={() => setChosenProvider(null)}
              onDirtyChange={(dirty) => {
                setEditorDirty(dirty);
                onDirtyChange?.(dirty);
              }}
              onDraftCopied={() => setChosenProvider("new")}
            />
          )}
      </SectionProfileSwitcher>
    </div>
  );
}
