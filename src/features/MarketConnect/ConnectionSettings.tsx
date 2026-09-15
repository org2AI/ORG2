import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Select from "@src/components/Select";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { handleMarketConnectionUrl } from "./deepLink";
import { type Connection, agentFor, loadConnections } from "./rpc";

const connectionId = (c: Connection) =>
  JSON.stringify([c.identity_user_id, c.workspace_id, c.target]);

type Saved = Connection & {
  phase: "authorization_saved" | "reauthorization_required";
};
export default function ConnectionSettings({
  agentName,
}: {
  agentName: string;
}) {
  const { t } = useTranslation("integrations");
  const [connections, setConnections] = useState<Saved[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const reload = () => {
      const attempt = ++generation;
      void loadConnections()
        .then((status) => {
          if (active && attempt === generation) {
            setEnabled(status.enabled);
            const next = status.connections.filter((c) =>
              agentName === "org2"
                ? c.target === "org2"
                : agentFor(c) === agentName
            );
            setConnections(next);
            setSelectedId((previous) =>
              next.some((c) => connectionId(c) === previous)
                ? previous
                : next[0]
                  ? connectionId(next[0])
                  : ""
            );
            setError(false);
          }
        })
        .catch(() => {
          if (active && attempt === generation) setError(true);
        });
    };
    reload();
    window.addEventListener("market-authorization-saved", reload);
    window.addEventListener("market-connections-changed", reload);
    return () => {
      active = false;
      window.removeEventListener("market-authorization-saved", reload);
      window.removeEventListener("market-connections-changed", reload);
    };
  }, [agentName]);
  if (
    agentName === "org2" &&
    enabled !== null &&
    !connections.length &&
    !error
  ) {
    return (
      <SectionContainer title="Market">
        <SectionRow label={t("marketConnection.title")} layout="vertical">
          <p className="text-text-2">
            {t(
              enabled
                ? "marketConnection.noSavedWorkspaces"
                : "marketConnection.moduleUnavailable"
            )}
          </p>
        </SectionRow>
      </SectionContainer>
    );
  }
  if ((!enabled || !connections.length) && !error) return null;
  const selected = connections.find((c) => connectionId(c) === selectedId);
  return (
    <SectionContainer title="Market">
      <SectionRow label={t("marketConnection.title")} layout="vertical">
        {connections.length > 1 && (
          <Select
            ariaLabel={t("marketConnection.title")}
            value={selectedId}
            options={connections.map((c) => ({
              value: connectionId(c),
              label: c.workspace_id,
            }))}
            onChange={(value) => setSelectedId(String(value))}
          />
        )}
        {selected && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("market-connection-open", {
                    detail: selected,
                  })
                )
              }
            >
              {t("marketConnection.manage")}
            </Button>
            {selected.phase === "reauthorization_required" && (
              <Button
                onClick={() =>
                  handleMarketConnectionUrl(
                    `orgii://market/connect?workspace_id=${encodeURIComponent(selected.workspace_id)}&target=${selected.target}`
                  )
                }
              >
                {t("marketConnection.reauthorize")}
              </Button>
            )}
          </div>
        )}
        {error && <p role="alert">{t("marketConnection.failed")}</p>}
      </SectionRow>
    </SectionContainer>
  );
}
