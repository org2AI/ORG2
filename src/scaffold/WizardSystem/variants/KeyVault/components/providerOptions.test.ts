import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { UnifiedProvider, UnifiedProviderVariant } from "../config";
import { resolveVariantLabel } from "./providerOptions";

const translate = ((key: string, fallback: string) =>
  fallback ?? key) as TFunction;

const provider = { label: "OpenAI" } as UnifiedProvider;

describe("resolveVariantLabel", () => {
  it("preserves localized subscription labels alongside API-key access", () => {
    const apiKey = {
      mode: "api_key",
      label: "API Key",
    } as UnifiedProviderVariant;
    const codex = {
      mode: "cli",
      label: "订阅",
    } as UnifiedProviderVariant;

    expect(resolveVariantLabel(apiKey, provider, translate)).toBe("API Key");
    expect(resolveVariantLabel(codex, provider, translate)).toBe("订阅");
  });
});
