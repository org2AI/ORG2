import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { saveKey } from "@src/api/services/keyValidation";
import type { ConnectionHarness } from "@src/api/tauri/rpc/schemas/agentOrgs";
import type { SaveKeyRequest } from "@src/api/types/keys";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import { SectionContainer } from "@src/components/layout/Section";
import { KeyVaultWizard } from "@src/scaffold/WizardSystem/variants/KeyVault";

import AppConnectionPage from "./AppConnectionPage";
import ClaudeProfileEditor from "./ClaudeProfileEditor";
import HarnessConnectionEditor from "./HarnessConnectionEditor";
import { refreshHarnessConnections } from "./useHarnessConnection";

export default function HarnessConnectionsSection() {
  const { t } = useTranslation("settings");
  const [target, setTarget] = useState<ConnectionHarness>("claude_code");
  const [profileDirty, setProfileDirty] = useState(false);
  const [advanced, setAdvanced] = useState(false);
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
        <SegmentedTextPill<ConnectionHarness>
          ariaLabel={t("harnessConnections.appSelector")}
          value={target}
          onChange={(next) => {
            setTarget(next);
            setAdvanced(false);
          }}
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
          ]}
        />
      </div>
      {!advanced ? (
        <>
          <AppConnectionPage
            key={target}
            target={target}
            onConfigureAccounts={() => setAdding(true)}
            onDirtyChange={setProfileDirty}
          />
          <div>
            <Button
              variant="tertiary"
              data-testid="harness-connections-advanced"
              onClick={() => setAdvanced(true)}
            >
              {t("harnessConnections.advanced")}
            </Button>
          </div>
        </>
      ) : (
        <SectionContainer
          titleSlot={
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {t("harnessConnections.advanced")}
              </span>
              <Button
                variant="tertiary"
                size="small"
                onClick={() => setAdvanced(false)}
              >
                {t("common:actions.back")}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 py-3">
            <p className="text-sm text-text-2">
              {t("harnessConnections.advancedDescription")}
            </p>
            {target === "codex" ? (
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
        </SectionContainer>
      )}
    </div>
  );
}
