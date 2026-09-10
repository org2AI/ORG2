import { useTranslation } from "react-i18next";

import type {
  ProviderEndpoint,
  ProviderProtocol,
} from "@src/api/tauri/rpc/schemas/validation";
import TabPill from "@src/components/TabPill";
import { SectionRow } from "@src/modules/shared/layouts/SectionLayout";

import {
  getOfficialBaseUrl,
  hasEndpointChoice,
} from "../../config/providerEndpoints";
import type { AgentSetupProps } from "./types";

interface ProviderEndpointSectionRowProps {
  /** Endpoints declared by the Rust provider registry. */
  endpoints: readonly ProviderEndpoint[];
  /** Id of the endpoint the current base URL resolves to. */
  selectedEndpointId: string | undefined;
  /** Protocol in effect — decides which of the endpoint's URLs is written. */
  protocol: ProviderProtocol;
  onChange: AgentSetupProps["onChange"];
}

/**
 * Endpoint picker for providers that expose the same API behind more than one
 * host: a regional split (Zhipu, MiniMax, SiliconFlow), a product tier
 * (OpenCode Zen vs Go), or an AWS region (Bedrock).
 *
 * Renders nothing for providers with a single endpoint, so call sites can drop
 * it in unconditionally.
 */
export function ProviderEndpointSectionRow({
  endpoints,
  selectedEndpointId,
  protocol,
  onChange,
}: ProviderEndpointSectionRowProps) {
  const { t } = useTranslation("integrations");

  if (!hasEndpointChoice(endpoints)) return null;

  const handleEndpointSelect = (endpointId: string) => {
    const endpoint = endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) return;

    // Switching endpoint repoints the key at a different host, so anything
    // learned from the old one (validation, model list) no longer holds.
    onChange({
      selected_endpoint_id: endpoint.id,
      extracted_base_url: getOfficialBaseUrl(endpoint, protocol),
      validated: false,
      available_models: [],
      model_context_lengths: {},
      enabled_models: [],
    });
  };

  return (
    <SectionRow
      label={t("keyVault.endpoint")}
      description={t("keyVault.endpointDesc")}
      layout="vertical"
      required
    >
      <div className="max-w-full overflow-x-auto">
        <TabPill
          tabs={endpoints.map((endpoint) => ({
            key: endpoint.id,
            label: endpoint.label,
          }))}
          activeTab={selectedEndpointId ?? ""}
          onChange={handleEndpointSelect}
          buttonStyle
          height={36}
        />
      </div>
    </SectionRow>
  );
}
