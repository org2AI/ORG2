/**
 * Model Info — OpenAI (GPT & o-series)
 *
 * Pattern-matched registry entries for GPT-4.x/5.x/6 and the o1/o3/o4 reasoning line.
 *
 * Extracted verbatim from `info.ts` during modularization; consumed by
 * `getModelInfo` in `@src/types/model/info`. See that file for the
 * pattern-matching semantics (first substring hit wins).
 */
import type { ModelInfoEntry } from "@src/types/model/info.types";

export const OPENAI_MODEL_INFO_ENTRIES: ModelInfoEntry[] = [
  // ─── OpenAI (GPT & o-series) ──────────────────────────────
  // https://developers.openai.com/api/docs/models/gpt-6-astra
  {
    pattern: "gpt-6-astra",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "premium",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-6.1-sol
  {
    pattern: "gpt-6.1-sol",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "moderate",
    },
  },
  // https://developers.openai.com/api/docs/models
  {
    pattern: "gpt-6-sol",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "gpt-6-luna",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "gpt-5.5",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "premium",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  {
    pattern: "gpt-5.6",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "premium",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-5.4-mini
  {
    pattern: "gpt-5.4-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 400,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-5.4-nano
  {
    pattern: "gpt-5.4-nano",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 400,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-5.4
  {
    pattern: "gpt-5.4",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1050,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "premium",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-5.3-codex
  {
    pattern: "gpt-5.3-codex",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 400,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["coding", "agentic"],
      pricingTier: "premium",
    },
  },
  // https://developers.openai.com/api/docs/models/gpt-5.2
  {
    pattern: "gpt-5.2",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 400,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["reasoning", "coding"],
      pricingTier: "premium",
    },
  },
  {
    pattern: "gpt-5",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 128,
      vision: true,
      reasoning: true,
      strengthKeys: ["longContext", "reasoning", "coding"],
      pricingTier: "premium",
    },
  },
  {
    pattern: "gpt-4.1",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      strengthKeys: ["longContext", "instructionFollowing", "coding"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "gpt-4o-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 128,
      maxOutput: 16,
      vision: true,
      strengthKeys: ["speed", "costEffective", "multimodal"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "gpt-4o",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 128,
      maxOutput: 16,
      vision: true,
      strengthKeys: ["multimodal", "balanced", "realtime"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "gpt-4.1-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 32,
      vision: true,
      strengthKeys: ["longContext", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "gpt-4.1-nano",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 1000,
      maxOutput: 32,
      vision: false,
      strengthKeys: ["longContext", "speed", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "o3-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "math", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "o4-mini",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "stem", "costEffective"],
      pricingTier: "budget",
    },
  },
  {
    pattern: "o4",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "stem"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "o3",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "math", "coding"],
      pricingTier: "moderate",
    },
  },
  {
    pattern: "o1",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 200,
      maxOutput: 100,
      vision: false,
      reasoning: true,
      strengthKeys: ["reasoning", "knowledge"],
      pricingTier: "expensive",
    },
  },
  // Generic GPT fallback
  {
    pattern: "gpt",
    info: {
      provider: "OpenAI",
      providerKey: "openai",
      contextWindow: 128,
      vision: true,
      strengthKeys: ["multimodal", "balanced"],
      pricingTier: "moderate",
    },
  },
];
