import { describe, expect, it } from "vitest";

import { KEY_SOURCE } from "@src/api/tauri/session";

import { entryMatchesActiveConfig } from "../modelSection";

describe("entryMatchesActiveConfig", () => {
  const entry = {
    modelId: "gpt-6-astra-medium",
    sourceType: KEY_SOURCE.OWN,
    accountId: "openai-key",
    accountName: "OpenAI",
    modelType: "codex" as const,
  };

  it("matches a recent entry holding another variant of the active family", () => {
    expect(
      entryMatchesActiveConfig(entry, {
        model: "gpt-6-astra-low",
        selectedAccountId: "openai-key",
      })
    ).toBe(true);
  });

  it("does not match another family or another key", () => {
    expect(
      entryMatchesActiveConfig(entry, {
        model: "gpt-5.6-sol-low",
        selectedAccountId: "openai-key",
      })
    ).toBe(false);
    expect(
      entryMatchesActiveConfig(entry, {
        model: "gpt-6-astra-low",
        selectedAccountId: "other-key",
      })
    ).toBe(false);
  });
});

it("marks a Package current after fresh preparation without matching another owner or engine", () => {
  const pinned = {
    modelId: "gpt-6-astra-low",
    sourceType: KEY_SOURCE.OWN,
    modelType: "codex" as const,
    cliAgentType: "codex" as const,
    accountName: "Package",
    marketProfileId: "market:00000000-0000-4000-8000-000000000001:pkg_one",
    credentialSource: "market:prepared-session-a",
  };
  const config = {
    model: "gpt-6-astra-high",
    marketProfileId: pinned.marketProfileId,
    credentialSource: "market:prepared-session-b",
    cliAgentType: "codex" as const,
    selectedSourceModelType: "codex" as const,
    selectedSourceLabel: "Package renamed",
  };
  expect(entryMatchesActiveConfig(pinned, config)).toBe(true);
  expect(
    entryMatchesActiveConfig(pinned, {
      ...config,
      marketProfileId: "market:00000000-0000-4000-8000-000000000002:pkg_one",
    })
  ).toBe(false);
  expect(
    entryMatchesActiveConfig(pinned, {
      ...config,
      cliAgentType: "claude_code",
      selectedSourceModelType: "claude_code",
    })
  ).toBe(false);
  expect(
    entryMatchesActiveConfig(pinned, { ...config, marketProfileId: undefined })
  ).toBe(false);
  expect(
    entryMatchesActiveConfig(pinned, {
      ...config,
      marketProfileId: undefined,
      credentialSource: pinned.credentialSource,
    })
  ).toBe(true);
});
