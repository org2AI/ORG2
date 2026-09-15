import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CliConfigManagedStatus } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import Select from "@src/components/Select";
import Modal, { MODAL_SELECT_Z_INDEX } from "@src/scaffold/ModalSystem";

import {
  type Connection,
  type Entry,
  applyConfig,
  disconnectConfig,
  loadConfig,
  loadEntries,
} from "./rpc";

const WorkspaceLaunch = lazy(() => import("./WorkspaceLaunch"));

export default function ConnectionDialog({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const { t } = useTranslation("integrations");
  const tr = (key: string) => t(`marketConnection.${key}`);
  const [purchases, setPurchases] = useState<
    { phase: "loading" | "failed" } | { phase: "ready"; entries: Entry[] }
  >({ phase: "loading" });
  const [purchaseRetry, setPurchaseRetry] = useState(0);
  const entries = purchases.phase === "ready" ? purchases.entries : [];
  const [entry, setEntry] = useState(""),
    [model, setModel] = useState("");
  const [config, setConfig] = useState<CliConfigManagedStatus | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [configured, setConfigured] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const supported =
    connection.target === "claude-code" ||
    connection.target === "codex" ||
    connection.target === "claude-app";
  useEffect(() => {
    alive.current = true;
    generation.current++;
    if (!supported) {
      setBusy(false);
      return () => {
        alive.current = false;
      };
    }
    let current = true;
    // Remote availability must never gate local recovery.
    setConfigured(false);
    setEntry("");
    setModel("");
    setConfig(null);
    setBusy(true);
    setError(false);
    void loadConfig(connection)
      .then((status) => {
        if (!current) return;
        setConfig(status);
        // The profile stores public selection metadata, never credentials.
        if (
          (status.mode === "orgii_managed" ||
            (connection.target === "claude-app" && status.mode === "direct")) &&
          status.selectedProvider === "market" &&
          status.selectedKeyId?.startsWith("market:")
        ) {
          try {
            const raw = status.selectedKeyId
              .slice(7)
              .replace(/-/g, "+")
              .replace(/_/g, "/");
            const saved = JSON.parse(atob(raw));
            const metadata = saved.metadata;
            if (
              metadata?.identity_user_id === connection.identity_user_id &&
              metadata.workspace_id === connection.workspace_id &&
              metadata.target === connection.target &&
              typeof saved.entitlement_id === "string" &&
              saved.entitlement_id.length > 0
            ) {
              setEntry(saved.entitlement_id);
              setModel(status.selectedModel ?? "");
              setConfigured(true);
              return;
            }
          } catch {
            /* An unrecognized profile is never reported configured. */
          }
        }
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      alive.current = false;
    };
  }, [connection, supported]);
  useEffect(() => {
    if (!supported) return;
    let current = true;
    setPurchases({ phase: "loading" });
    void loadEntries(connection)
      .then((all) => {
        if (!current) return;
        const agent = connection.target === "codex" ? "codex" : "claude";
        const active = all
          .map((e) => ({ ...e, models: e.models_by_agent[agent] }))
          .filter(
            (e) =>
              e.status === "active" &&
              e.models.length > 0 &&
              (e.expires_at === null || e.expires_at > Date.now())
          );
        setPurchases({ phase: "ready", entries: active });
        if (active.length === 1) {
          setEntry((value) => value || active[0].entitlement_id);
          setModel((value) => value || active[0].models[0] || "");
        }
      })
      .catch(() => {
        if (current) setPurchases({ phase: "failed" });
      });
    return () => {
      current = false;
    };
  }, [connection, supported, purchaseRetry]);
  const selected = entries.find((e) => e.entitlement_id === entry);
  const run = async (disconnect = false) => {
    if (!disconnect && (!entry || !config)) return;
    const attempt = generation.current;
    const current = () => alive.current && generation.current === attempt;
    setBusy(true);
    setError(false);
    try {
      if (disconnect) {
        await disconnectConfig(connection);
        window.dispatchEvent(new Event("market-connections-changed"));
        if (current()) onClose();
      } else {
        const hashes = Object.fromEntries(
          config!.targetFiles.map((file) => [file.id, file.currentHash ?? null])
        );
        const result = await applyConfig(connection, entry, model, hashes);
        if (current()) {
          setConfig(result);
          setConfigured(true);
        }
      }
    } catch {
      if (current()) setError(true);
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <Modal
      visible
      title={tr("title")}
      onCancel={() => {
        if (!busy) onClose();
      }}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex gap-2">
          <Button disabled={busy} onClick={onClose}>
            {tr("close")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void run(true)}
          >
            {tr("disconnect")}
          </Button>
          {!configured && (
            <Button
              variant="primary"
              loading={busy}
              disabled={
                !supported || !selected || !model || !config || config.conflict
              }
              onClick={() => void run()}
            >
              {tr("configure")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {configured && selected?.models.includes(model) && (
          <Suspense fallback={null}>
            <WorkspaceLaunch
              connection={connection}
              selection={config?.selectedKeyId ?? null}
              model={model}
              onClose={onClose}
            />
          </Suspense>
        )}
        <p className="text-text-2">
          {connection.workspace_id} · {connection.target}
        </p>
        {!supported ? (
          <p role="status">{tr("adapterPending")}</p>
        ) : (
          <>
            <label className="flex flex-col gap-2">
              <span>{tr("listing")}</span>
              <Select
                ariaLabel={tr("listing")}
                value={entry}
                disabled={busy || configured}
                options={entries.map((e) => ({
                  value: e.entitlement_id,
                  label: e.service_name,
                }))}
                onChange={(value) => {
                  const id = String(value);
                  setEntry(id);
                  setModel(
                    entries.find((e) => e.entitlement_id === id)?.models[0] ??
                      ""
                  );
                }}
                panelZIndex={MODAL_SELECT_Z_INDEX}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span>{tr("model")}</span>
              <Select
                ariaLabel={tr("model")}
                value={model}
                disabled={busy || configured}
                options={(selected?.models ?? []).map((id) => ({
                  value: id,
                  label: id,
                }))}
                onChange={(value) => setModel(String(value))}
                panelZIndex={MODAL_SELECT_Z_INDEX}
              />
            </label>
            {purchases.phase === "loading" && (
              <p role="status">{tr("loadingPurchases")}</p>
            )}
            {purchases.phase === "failed" && (
              <div role="alert">
                <p>{tr("purchasesFailed")}</p>
                <Button
                  disabled={busy}
                  onClick={() => setPurchaseRetry((value) => value + 1)}
                >
                  {tr("retryPurchases")}
                </Button>
              </div>
            )}
            {purchases.phase === "ready" && !entries.length && (
              <p role="status">{tr("noPurchases")}</p>
            )}
            {config?.conflict && <p role="alert">{tr("conflict")}</p>}
            {configured && <p role="status">{tr("configured")}</p>}
          </>
        )}
        {error && <p role="alert">{tr("failed")}</p>}
      </div>
    </Modal>
  );
}
