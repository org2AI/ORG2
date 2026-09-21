import type { ModelType } from "@src/api/types/keys";

import type { IconProvider } from "./iconProviders";
import { MODEL_TYPE_TO_ICON } from "./modelTypeIcons";

/**
 * Routing tiers, not models: "auto", "default" and "premium" are the names
 * Cursor gives its own tiers, but every other agent uses the same words
 * generically — a `claude_code` account's "default" means "whatever the CLI
 * picks". Claiming them for Cursor unconditionally painted the Cursor cube on
 * unrelated agents' rows, so they resolve to a brand only when the agent hint
 * is Cursor itself.
 */
const GENERIC_TIER_MODEL_NAMES = new Set(["auto", "default", "premium"]);

/**
 * True for model ids that name a routing tier rather than a model. Such a name
 * carries no brand, so callers must not fall back to the agent's mark for it —
 * that would claim the session runs a specific model.
 */
export function isGenericTierModelName(modelName: string): boolean {
  return GENERIC_TIER_MODEL_NAMES.has(modelName.toLowerCase());
}

/**
 * Detect icon provider from model name.
 * @param modelName - The model name string (e.g. "gpt-4o", "composer-1", "auto")
 * @param agentType - Optional agent type hint for generic names like "auto"
 */
export function getIconProviderFromModelName(
  modelName: string,
  agentType?: string
): IconProvider {
  const lower = modelName.toLowerCase();

  // Routing tiers only name a brand when the agent behind them is Cursor.
  if (GENERIC_TIER_MODEL_NAMES.has(lower)) {
    const hinted = agentType
      ? (MODEL_TYPE_TO_ICON[agentType as ModelType] as IconProvider | undefined)
      : undefined;
    return hinted === "cursor" || agentType === "cursor" ? "cursor" : "unknown";
  }

  // Cursor models (the Composer family)
  if (lower.includes("composer")) {
    return "cursor";
  }

  // GitHub Copilot models (copilot-chat, copilot-premium, etc.)
  if (lower.includes("copilot")) {
    return "copilot";
  }

  // OpenAI models (provider-prefixed OpenRouter IDs, GPT series, O-series,
  // Codex variants, etc.)
  if (
    lower.startsWith("openai/") ||
    lower.includes("gpt") ||
    lower.includes("codex") ||
    /^o\d/.test(lower)
  ) {
    return "openai";
  }

  // Anthropic/Claude models (including model family names + Cursor's
  // "op-*-relay" tier name, which is an Opus-class proxy and should
  // share the Claude brand mark — same shape of normalization as
  // OpenAI's `^o\d` rule above for o-series models like "o5.5-high").
  if (
    lower.includes("claude") ||
    lower.includes("fable") ||
    lower.includes("haiku") ||
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    /^op[-_]/.test(lower)
  ) {
    return "claude";
  }

  // Google/Gemini/Gemma models
  if (
    lower.startsWith("google/") ||
    lower.includes("gemini") ||
    lower.includes("gemma")
  ) {
    return "gemini";
  }

  // xAI/Grok models
  if (lower.includes("grok")) {
    return "grok";
  }

  // DeepSeek models
  if (lower.includes("deepseek")) {
    return "deepseek";
  }

  // Cohere models
  if (lower.startsWith("cohere/") || lower.includes("command-r")) {
    return "cohere";
  }

  // Mistral models
  if (lower.includes("mistral") || lower.includes("mixtral")) {
    return "mistral";
  }

  // Alibaba/Qwen models
  if (lower.includes("qwen")) {
    return "qwen";
  }

  // NVIDIA/Nemotron models
  if (
    lower.includes("nvidia") ||
    lower.includes("nvdia") ||
    lower.includes("nemotron")
  ) {
    return "nvidia";
  }

  // Meta AI's Muse family (muse-spark-*) carries the Meta AI mark, not the
  // Llama-era Meta logo; this sits above that rule so "meta/muse-*" lands here.
  if (/(?:^|[^a-z0-9])muse(?:[^a-z0-9]|$)/.test(lower)) {
    return "meta_ai";
  }

  // Meta/Llama models
  if (lower.includes("llama") || lower.includes("meta")) {
    return "meta";
  }

  // Perplexity models
  if (lower.includes("perplexity") || lower.includes("pplx")) {
    return "perplexity";
  }

  // ZenMux provider/model slugs
  if (lower.includes("zenmux")) {
    return "zenmux";
  }

  // Moonshot/Kimi models
  if (lower.includes("kimi") || lower.includes("moonshot")) {
    return "kimi";
  }

  // Tencent Hunyuan models
  if (lower.includes("hunyuan") || /^hy(?:\d|[-_])/.test(lower)) {
    return "hunyuan";
  }

  // Local runtimes
  if (lower.includes("ollama")) {
    return "ollama";
  }
  if (lower.includes("lmstudio") || lower.includes("lm-studio")) {
    return "lm_studio";
  }
  if (lower.includes("llama.cpp") || lower.includes("llama-cpp")) {
    return "llamacpp";
  }

  // ByteDance/Doubao models
  if (lower.includes("bytedance")) {
    return "bytedance";
  }

  // Doubao (ByteDance's model name)
  if (lower.includes("doubao")) {
    return "doubao";
  }

  // Volcengine models
  if (lower.includes("volcengine") || lower.includes("volc")) {
    return "volcengine";
  }

  // Xiaomi/MiMo models
  if (lower.startsWith("xiaomi/") || lower.includes("mimo")) {
    return "xiaomi";
  }

  // 01.AI/Yi models
  if (lower.includes("yi-") || lower === "yi" || lower.includes("01.ai")) {
    return "yi";
  }

  // ZCode IDE / Z.ai coding workspace
  if (lower.includes("zcode")) {
    return "zcode";
  }

  // Qoder IDE (Alibaba's agentic IDE)
  if (lower.includes("qoder")) {
    return "qoder";
  }

  // Zhipu/GLM models
  if (
    lower.includes("zhipu") ||
    lower.includes("glm") ||
    lower.includes("chatglm")
  ) {
    return "zhipu";
  }

  // Baichuan models
  if (lower.includes("baichuan")) {
    return "baichuan";
  }

  // Minimax models
  if (lower.includes("minimax") || lower.includes("abab")) {
    return "minimax";
  }

  // LongCat models
  if (lower.includes("longcat") || lower.startsWith("meituan/")) {
    return "longcat";
  }

  return "unknown";
}
