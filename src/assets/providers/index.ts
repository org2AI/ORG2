// ============================================
// Agent Type Configuration
// ============================================
import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validation";
import type { ApiProviderType } from "@src/api/types/keys";

// Preserve the provider API while exporting types from their owner
export type {
  CliAgentType,
  ApiProviderType,
  ModelType,
} from "@src/api/types/keys";
export { ORGII_ORCHESTRATOR } from "./types";

/** Registry spellings that cannot be recovered by title-casing an agent ID. */
const AGENT_TYPE_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  [CLI_AGENT.CURSOR]: "Cursor",
  [CLI_AGENT.KIRO]: "Kiro CLI",
  [CLI_AGENT.COPILOT]: "GitHub Copilot",
  [CLI_AGENT.KIMI]: "Kimi Code CLI",
  [CLI_AGENT.OPENCODE]: "OpenCode",
  [CLI_AGENT.KILO]: "Kilo Code",
  [CLI_AGENT.OPENCLAW]: "OpenClaw",
  [CLI_AGENT.CONTINUE]: "Continue",
  [CLI_AGENT.OMP]: "OMP",
  [CLI_AGENT.TRAE_CLI]: "Trae Agent",
  [CLI_AGENT.DEEPSEEK_HARNESS]: "DeepSeek Harness",
};

/**
 * Format an agent type string into a human-readable display name.
 * Converts snake_case to Title Case and strips common suffixes.
 * Prefer backend-provided `displayName` when available; use this as a fallback.
 */
export function formatAgentType(agentType: string): string {
  if (!agentType) return "";
  const override = AGENT_TYPE_LABEL_OVERRIDES[agentType];
  if (override) return override;
  return agentType
    .replace(/_api$/, "")
    .replace(/_cli$/, " CLI")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Agent type label for model catalog / model table surfaces. */
export function formatModelAgentType(agentType: string): string {
  return formatAgentType(agentType);
}

/** API key provider types in alphabetical order by label */
const API_KEY_PROVIDER_LIST: ApiProviderType[] = [
  "anthropic_api", // Anthropic
  "atlascloud_api", // Atlas Cloud
  "azure_anthropic_api", // Azure Anthropic
  "azure_openai_api", // Azure OpenAI
  "deepseek_api", // DeepSeek
  "gemini_api", // Google Gemini
  "groq_api", // Groq
  "xai_api", // xAI Grok
  "minimax_api", // MiniMax
  "longcat_api", // LongCat
  "moonshot_api", // Kimi Moonshot
  "openai_api", // OpenAI
  "openrouter_api", // OpenRouter
  "dashscope_api", // Qwen
  "orgii_orchestrator", // ORGII (Token Market)
  "vllm_api", // vLLM / Local
  "zenmux_api", // ZenMux
  "zhipu_api", // Zhipu AI
];

const _API_KEY_PROVIDER_SET: ReadonlySet<string> = new Set(
  API_KEY_PROVIDER_LIST
);

/** Check if an agent type is an API key provider (direct API key, not CLI agent) */
export function isApiKeyProvider(agentType: string): boolean {
  return _API_KEY_PROVIDER_SET.has(agentType);
}
