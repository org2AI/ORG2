import { open } from "@tauri-apps/plugin-dialog";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadAvailableAgents } from "@src/api/services/availableAgents";
import {
  type SessionLaunchResult,
  sessionLaunch,
} from "@src/api/tauri/agent/session";
import Button from "@src/components/Button";
import Select from "@src/components/Select";
import { ROUTES } from "@src/config/routes";
import { useChatPanelNavigationActions } from "@src/engines/ChatPanel/hooks/useChatPanelNavigationActions";
import { useAppNavigate } from "@src/hooks/navigation/useAppNavigate";
import Modal, { MODAL_SELECT_Z_INDEX } from "@src/scaffold/ModalSystem";
import { openOrFocusSessionInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabOpen/session";
import { loadSidebarSessionById } from "@src/store/session/sessionAtom/exactSessionLoad";

import {
  type Connection,
  type Entry,
  disconnectConfig,
  loadEntries,
  prepareSessionSource,
} from "./rpc";

const choices = (entry?: Entry) =>
  entry
    ? (["claude_code", "codex"] as const).flatMap((agent) =>
        entry.models_by_agent[agent === "codex" ? "codex" : "claude"].map(
          (model) => ({
            value: JSON.stringify([agent, model]),
            agent,
            model,
            label: `${agent === "codex" ? "Codex" : "Claude Code"} · ${model}`,
          })
        )
      )
    : [];

export default function Org2SessionDialog({
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
  const [retry, setRetry] = useState(0);
  const [entitlement, setEntitlement] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true),
    running = useRef(false);
  // If UI hydration fails after creation, retry opens the same persisted row.
  const created = useRef<SessionLaunchResult | null>(null);
  const openTab = useSetAtom(openOrFocusSessionInChatPanelTabAtom);
  const navigate = useAppNavigate();
  const { showSessionSurface } = useChatPanelNavigationActions();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setPurchases({ phase: "loading" });
    void loadEntries(connection)
      .then((all) => {
        if (!current) return;
        const entries = all.filter(
          (entry) =>
            entry.status === "active" &&
            (entry.expires_at === null || entry.expires_at > Date.now())
        );
        setPurchases({ phase: "ready", entries });
        setEntitlement((previous) =>
          entries.some((entry) => entry.entitlement_id === previous)
            ? previous
            : (entries[0]?.entitlement_id ?? "")
        );
      })
      .catch(() => {
        if (current) setPurchases({ phase: "failed" });
      });
    return () => {
      current = false;
    };
  }, [connection, retry]);
  const entries = purchases.phase === "ready" ? purchases.entries : [];
  const selected = entries.find(
    (entry) => entry.entitlement_id === entitlement
  );
  const models = choices(selected);
  const model = models.find((item) => item.value === choice) ?? models[0];
  const act = async (disconnect: boolean) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      if (disconnect) {
        await disconnectConfig(connection);
        window.dispatchEvent(new Event("market-connections-changed"));
        if (alive.current) onClose();
        return;
      }
      if (!created.current) {
        if (!selected || !model) return;
        const folder = await open({ directory: true, multiple: false });
        if (!alive.current || typeof folder !== "string") return;
        const agents = await loadAvailableAgents();
        if (!alive.current) return;
        if (
          !agents.some((agent) => agent.name === model.agent && agent.installed)
        ) {
          setError("clientMissing");
          return;
        }
        const credentialSource = await prepareSessionSource(
          connection,
          entitlement,
          model.agent,
          model.model
        );
        if (!alive.current) return;
        created.current = await sessionLaunch({
          category: "cli_agent",
          content: "",
          platform: model.agent,
          credentialSource,
          model: model.model,
          workspacePath: folder,
          isolate: false,
          name: selected.service_name,
        });
      }
      const session = created.current;
      if (!alive.current) return;
      const loaded = await loadSidebarSessionById(session.sessionId);
      if (!loaded) throw Error("Created session unavailable");
      if (!alive.current) return;
      openTab({
        sessionId: session.sessionId,
        sessionName: session.name,
        repoPath: session.workspacePath ?? undefined,
      });
      showSessionSurface();
      navigate(ROUTES.workStation.base.path);
      onClose();
    } catch {
      if (alive.current) setError(disconnect ? "failed" : "launchFailed");
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
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
            onClick={() => void act(true)}
          >
            {tr("disconnect")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!created.current && (!selected || !model)}
            onClick={() => void act(false)}
          >
            {tr("openWorkspace")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-text-2">{connection.workspace_id} · ORG2</p>
        <label className="flex flex-col gap-2">
          <span>{tr("listing")}</span>
          <Select
            ariaLabel={tr("listing")}
            value={entitlement}
            disabled={busy || !!created.current}
            options={entries.map((entry) => ({
              value: entry.entitlement_id,
              label: entry.service_name,
            }))}
            onChange={(value) => {
              setEntitlement(String(value));
              setChoice("");
            }}
            panelZIndex={MODAL_SELECT_Z_INDEX}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span>{tr("model")}</span>
          <Select
            ariaLabel={tr("model")}
            value={model?.value ?? ""}
            disabled={busy || !!created.current}
            options={models}
            onChange={(value) => setChoice(String(value))}
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
              onClick={() => setRetry((value) => value + 1)}
            >
              {tr("retryPurchases")}
            </Button>
          </div>
        )}
        {purchases.phase === "ready" && !entries.length && (
          <p role="status">{tr("noPurchases")}</p>
        )}
        {error && <p role="alert">{tr(error)}</p>}
      </div>
    </Modal>
  );
}
