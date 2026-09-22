import type { TFunction } from "i18next";

import type { ModelType } from "@src/api/types/keys";
import { PROJECT_ADAPTER_TYPES } from "@src/scaffold/WizardSystem/variants/Channel/channelWizardTypes";

import {
  WIZARD_IDS,
  buildIntegrationsPath,
  buildWizardPath,
  parseWizardParam,
} from "./mainAppPaths";

/** Explicit entry points supported by the existing setup wizards. No account fetches. */
export const KEY_SETUP_PROVIDERS = [
  { type: "openai_api", label: "OpenAI", aliases: ["GPT", "ChatGPT"] },
  { type: "anthropic_api", label: "Anthropic", aliases: ["Claude"] },
  { type: "gemini_api", label: "Google Gemini", aliases: ["Google"] },
  { type: "openrouter_api", label: "OpenRouter", aliases: [] },
  { type: "deepseek_api", label: "DeepSeek", aliases: [] },
  { type: "groq_api", label: "Groq", aliases: [] },
  { type: "xai_api", label: "xAI Grok", aliases: ["Grok"] },
] as const satisfies readonly {
  type: ModelType;
  label: string;
  aliases: readonly string[];
}[];

export function parseSettingsSetupProvider(search: string) {
  const { wizard } = parseWizardParam(search);
  const provider = new URLSearchParams(search).get("setupProvider");
  return {
    keyProvider:
      wizard === WIZARD_IDS.KEY_ADD
        ? KEY_SETUP_PROVIDERS.find((entry) => entry.type === provider)?.type
        : undefined,
    connectionProvider:
      wizard === WIZARD_IDS.CHANNEL_ADD
        ? PROJECT_ADAPTER_TYPES.find((entry) => entry.type === provider)?.type
        : undefined,
  };
}

export function buildSettingsSetupActions(t: TFunction) {
  const keyPath = buildWizardPath(
    buildIntegrationsPath({ category: "models" }),
    WIZARD_IDS.KEY_ADD
  );
  const connectionPath = buildWizardPath(
    buildIntegrationsPath({ category: "connections" }),
    WIZARD_IDS.CHANNEL_ADD
  );
  return [
    {
      id: "add-key",
      pageId: "models",
      label: t("integrations:cliPreview.addKey"),
      path: keyPath,
      searchTerms: ["API key", "credentials", "BYOK", "add account"],
    },
    ...KEY_SETUP_PROVIDERS.map(({ type, label, aliases }) => ({
      id: `add-key-${type}`,
      pageId: "models",
      label: `${label} · ${t("integrations:cliPreview.addKey")}`,
      path: `${keyPath}&setupProvider=${type}`,
      searchTerms: [
        label,
        ...aliases,
        "API key",
        "credentials",
        "BYOK",
        "add account",
      ],
    })),
    {
      id: "add-connection",
      pageId: "connections",
      label: t("integrations:integrations.addAccount"),
      path: connectionPath,
      searchTerms: ["connect", "integration", "add connection"],
    },
    ...PROJECT_ADAPTER_TYPES.map(({ type, labelKey }) => ({
      id: `connect-${type}`,
      pageId: "connections",
      label: `${t(`integrations:${labelKey}`)} · ${t("integrations:integrations.addAccount")}`,
      path: `${connectionPath}&setupProvider=${type}`,
      searchTerms: [
        type,
        "connect",
        "add connection",
        "OAuth",
        "token",
        "PAT",
        ...(type === "github" ? ["SSH", "repository"] : []),
      ],
    })),
  ];
}
