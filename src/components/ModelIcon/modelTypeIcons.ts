import type { ModelType } from "@src/api/types/keys";

import type { IconProvider } from "./iconProviders";

// ============================================
// ModelType → IconProvider Mapping
// ============================================

/**
 * Maps ModelType (business logic) to IconProvider (UI display).
 *
 * This is the single source of truth for converting business types to icon brands.
 */
export const MODEL_TYPE_TO_ICON: Record<ModelType, IconProvider> = {
  // CLI agents (active)
  cursor_cli: "cursor",
  copilot: "copilot",
  claude_code: "claude_code",
  codex: "codex",
  kiro: "kiro",
  kimi_cli: "kimi",
  opencode: "opencode",
  // Extended CLI agents
  aider: "aider",
  goose: "goose",
  amp: "amp",
  cline: "cline",
  kilo: "kilo",
  grok_cli: "grok",
  devin: "devin",
  rovo: "rovo",
  hermes: "hermes",
  openclaw: "openclaw",
  aug: "aug",
  codebuff: "codebuff",
  qwen_code: "qwen_code",
  mimo_code: "mimo_code",
  antigravity: "antigravity",
  continue_cli: "continue_cli",
  droid: "droid",
  mistral_vibe: "mistral_vibe",
  autohand: "autohand",
  omp: "omp",
  pi: "pi",
  qoder_cli: "qoder",
  trae_cli: "trae",
  deepseek_harness: "deepseek",
  // API key providers
  anthropic_api: "claude",
  openai_api: "openai",
  atlascloud_api: "atlascloud",
  deepseek_api: "deepseek",
  gemini_api: "gemini",
  groq_api: "groq",
  xai_api: "grok",
  zhipu_api: "zhipu",
  dashscope_api: "qwen",
  minimax_api: "minimax",
  longcat_api: "longcat",
  siliconflow_api: "siliconflow",
  modelscope_api: "modelscope",
  aihubmix_api: "aihubmix",
  cherryin_api: "cherryin",
  bedrock_api: "aws",
  custom_api: "custom",
  moonshot_api: "kimi",
  openrouter_api: "openrouter",
  zenmux_api: "zenmux",
  vllm_api: "vllm",
  azure_openai_api: "azure",
  azure_anthropic_api: "azure",
  orgii_orchestrator: "orgii",
  // Short aliases (for validation convenience)
  openai: "openai",
  anthropic: "claude",
  google: "gemini",
};
