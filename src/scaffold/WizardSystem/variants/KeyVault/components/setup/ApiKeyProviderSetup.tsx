/**
 * ApiKeyProviderSetup Component
 *
 * Simplified credential input for direct API key providers.
 * No auto-detect, no OAuth, no extract -- just clean key + optional base URL entry.
 *
 * Uses SectionContainer + SectionRow (matching MCP/Skills wizard pattern).
 * Base URL has Official URL / Custom URL select; when Official, input is disabled.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import TabPill from "@src/components/TabPill";
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";

import { useProviderConfig } from "../../config";
import {
  getOfficialBaseUrl,
  hasEndpointChoice,
  resolveSelectedEndpoint,
} from "../../config/providerEndpoints";
import { ApiProtocolSectionRow } from "./ApiProtocolSectionRow";
import { CustomBaseUrlInfoIcon } from "./CustomBaseUrlInfoIcon";
import { ProviderEndpointSectionRow } from "./ProviderEndpointSectionRow";
import type { AgentSetupProps } from "./types";

type BaseUrlMode = "official" | "custom";

const ApiKeyProviderSetup: React.FC<AgentSetupProps> = ({
  data,
  onChange,
  keyValidated,
  validatingKey,
  validateKey,
}) => {
  const { t } = useTranslation("integrations");
  const { config: envConfig, loading: configLoading } = useProviderConfig(
    data.agent_type
  );

  const supportsProtocolSelection =
    (envConfig?.supportedProtocols.length ?? 0) > 1;
  const selectedProtocol =
    data.protocol ?? envConfig?.defaultProtocol ?? "openai";

  const endpoints = useMemo(
    () => envConfig?.endpoints ?? [],
    [envConfig?.endpoints]
  );
  const offersEndpointChoice = hasEndpointChoice(endpoints);
  const selectedEndpoint = resolveSelectedEndpoint(
    endpoints,
    data.extracted_base_url,
    data.selected_endpoint_id
  );
  const officialBaseUrl = getOfficialBaseUrl(
    selectedEndpoint,
    selectedProtocol,
    envConfig?.defaultBaseUrl
  );

  // Determine if user's current URL differs from the official default
  const hasCustomBaseUrl = useMemo(() => {
    return Boolean(
      envConfig?.supportsBaseUrl &&
      officialBaseUrl &&
      data.extracted_base_url &&
      data.extracted_base_url !== officialBaseUrl
    );
  }, [envConfig, officialBaseUrl, data.extracted_base_url]);

  // Track user's explicit mode choice. Defaults to "custom" if data has a non-default URL.
  const [baseUrlModeOverride, setBaseUrlModeOverride] =
    useState<BaseUrlMode | null>(null);
  const baseUrlMode: BaseUrlMode =
    baseUrlModeOverride ?? (hasCustomBaseUrl ? "custom" : "official");
  const setBaseUrlMode = (mode: BaseUrlMode) => setBaseUrlModeOverride(mode);

  // Track last synced values to avoid duplicate onChange calls
  const lastSyncedRef = useRef<{ mode: BaseUrlMode; url: string | undefined }>({
    mode: baseUrlMode,
    url: data.extracted_base_url,
  });

  // Sync official URL to data when in official mode (for validation)
  // This is intentional: when mode changes to "official", we need to update parent state
  useEffect(() => {
    // A provider with a choice of endpoints has no meaningful "unset" base URL:
    // validation has to know which host the key belongs to. Seed the default.
    if (offersEndpointChoice && !data.extracted_base_url && officialBaseUrl) {
      onChange({ extracted_base_url: officialBaseUrl });
      lastSyncedRef.current = { mode: baseUrlMode, url: officialBaseUrl };
      return;
    }

    const needsSync =
      envConfig?.supportsBaseUrl &&
      baseUrlMode === "official" &&
      officialBaseUrl &&
      data.extracted_base_url !== officialBaseUrl;

    // Only sync if mode changed to official (not on every render)
    const modeChangedToOfficial =
      lastSyncedRef.current.mode !== "official" && baseUrlMode === "official";

    if (needsSync && modeChangedToOfficial && officialBaseUrl) {
      onChange({ extracted_base_url: officialBaseUrl });
    }

    lastSyncedRef.current = {
      mode: baseUrlMode,
      url: data.extracted_base_url,
    };
  }, [
    envConfig,
    offersEndpointChoice,
    officialBaseUrl,
    baseUrlMode,
    data.extracted_base_url,
    onChange,
  ]);

  if (configLoading || !envConfig) {
    return null;
  }

  return (
    <div className={SECTION_GAP_CLASSES}>
      <SectionContainer>
        <SectionRow
          label={t("keyVault.apiKeyLabel")}
          layout="vertical"
          required
        >
          <Input
            value={data.raw_key_input}
            onChange={(value: string) => onChange({ raw_key_input: value })}
            placeholder={t("keyVault.apiKeyPlaceholder")}
            size="default"
            className="w-full"
          />
        </SectionRow>

        <ProviderEndpointSectionRow
          endpoints={endpoints}
          selectedEndpointId={selectedEndpoint?.id}
          protocol={selectedProtocol}
          onChange={onChange}
        />

        {supportsProtocolSelection && (
          <ApiProtocolSectionRow
            selectedEndpoint={selectedEndpoint}
            selectedProtocol={selectedProtocol}
            supportedProtocols={envConfig.supportedProtocols}
            defaultBaseUrl={envConfig.defaultBaseUrl}
            baseUrlMode={baseUrlMode}
            extractedBaseUrl={data.extracted_base_url}
            onChange={onChange}
          />
        )}

        {envConfig.supportsBaseUrl && (
          <SectionRow
            label={
              <span className="inline-flex items-center gap-1">
                {t("keyVault.baseUrlLabel")}
                {baseUrlMode === "custom" ? <CustomBaseUrlInfoIcon /> : null}
              </span>
            }
            layout="vertical"
          >
            <div className="flex items-center gap-2">
              <TabPill
                tabs={[
                  { key: "official", label: t("keyVault.officialUrl") },
                  { key: "custom", label: t("keyVault.customUrl") },
                ]}
                activeTab={baseUrlMode}
                onChange={(key) => {
                  const mode = key as BaseUrlMode;
                  setBaseUrlMode(mode);
                  if (mode === "official") {
                    onChange({
                      extracted_base_url: officialBaseUrl || undefined,
                    });
                  }
                }}
                variant="pill"
                buttonStyle
                fillWidth={false}
                height={32}
                className="shrink-0"
              />
              <Input
                value={
                  baseUrlMode === "official"
                    ? officialBaseUrl || ""
                    : data.extracted_base_url || ""
                }
                onChange={(value: string) =>
                  onChange({ extracted_base_url: value || undefined })
                }
                placeholder={
                  baseUrlMode === "custom" ? officialBaseUrl || "" : undefined
                }
                size="default"
                className="min-w-0 flex-1"
                disabled={baseUrlMode === "official"}
              />
            </div>
          </SectionRow>
        )}
      </SectionContainer>

      <SectionContainer>
        <SectionRow label={t("keyVault.validate", "Validate")} required>
          <Button
            variant={keyValidated ? "secondary" : "primary"}
            tone={keyValidated ? "success" : undefined}
            loading={validatingKey}
            disabled={validatingKey || !data.raw_key_input}
            onClick={validateKey}
            className="h-8 min-h-8"
          >
            {keyValidated
              ? `✓ ${t("keyVault.validated", "Validated")}`
              : t("keyVault.validate", "Validate")}
          </Button>
        </SectionRow>
      </SectionContainer>
    </div>
  );
};

export { ApiKeyProviderSetup };
