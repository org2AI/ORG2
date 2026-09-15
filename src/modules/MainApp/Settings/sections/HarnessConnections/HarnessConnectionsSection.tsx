import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { saveKey } from "@src/api/services/keyValidation";
import type { ConnectionHarness } from "@src/api/tauri/rpc/schemas/agentOrgs";
import type { SaveKeyRequest } from "@src/api/types/keys";
import Message from "@src/components/Message";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import ConnectionSettings from "@src/features/MarketConnect/ConnectionSettings";
import InlineCredentialImport from "@src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport";
import { KeyVaultWizard } from "@src/scaffold/WizardSystem/variants/KeyVault";

import ClaudeProfileEditor from "./ClaudeProfileEditor";
import HarnessConnectionEditor from "./HarnessConnectionEditor";
import { refreshHarnessConnections } from "./useHarnessConnection";

export default function HarnessConnectionsSection() {
  const { t } = useTranslation("settings");
  const [target, setTarget] = useState<ConnectionHarness | "org2">(
    "claude_code"
  );
  const [profileDirty, setProfileDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async (data: SaveKeyRequest) => {
    setSaving(true);
    try {
      await saveKey(data);
      setAdding(false);
      refreshHarnessConnections();
    } catch (error) {
      Message.error({ content: String(error) });
    } finally {
      setSaving(false);
    }
  };
  if (adding)
    return (
      <KeyVaultWizard
        initialAgentType="custom_api"
        primaryProvidersOnly={false}
        title={t("harnessConnections.add")}
        loading={saving}
        onSubmit={(data) => void submit(data)}
        onCancel={() => setAdding(false)}
      />
    );
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="harness-connections-settings"
    >
      <div className="overflow-x-auto">
        <SegmentedTextPill<ConnectionHarness | "org2">
          ariaLabel={t("harnessConnections.appSelector")}
          value={target}
          onChange={setTarget}
          options={[
            {
              value: "claude_code",
              label: "Claude Code CLI",
              disabled: profileDirty,
            },
            {
              value: "claude_desktop",
              label: "Claude Desktop",
              disabled: profileDirty,
            },
            { value: "codex", label: "Codex", disabled: profileDirty },
            { value: "org2", label: "ORG2", disabled: profileDirty },
          ]}
        />
      </div>
      {target !== "org2" && (
        <InlineCredentialImport onAfterImport={refreshHarnessConnections} />
      )}
      <ConnectionSettings key={`market:${target}`} agentName={target} />
      {target === "org2" ? null : target === "codex" ? (
        <HarnessConnectionEditor
          key={target}
          agentName={target}
          onAdd={() => setAdding(true)}
        />
      ) : (
        <ClaudeProfileEditor
          key={target}
          target={target}
          onDirtyChange={setProfileDirty}
          onAdd={() => setAdding(true)}
        />
      )}
    </div>
  );
}
