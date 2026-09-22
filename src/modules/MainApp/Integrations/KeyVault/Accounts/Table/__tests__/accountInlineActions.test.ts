import { describe, expect, it } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault";

import {
  areAccountRefreshActionsDisabled,
  reconnectableOAuthAgent,
} from "../accountInlineActions";

function createAccount(
  overrides: Partial<KeyVaultAccount> = {}
): KeyVaultAccount {
  return {
    id: "codex-account",
    hasLocalKey: true,
    isListed: false,
    modelType: "codex",
    name: "Codex",
    status: "error",
    hasKey: true,
    hasApiKey: false,
    hasSessionToken: true,
    authMethod: "oauth",
    enabled: false,
    healthStatus: "invalid",
    ...overrides,
  };
}

describe("areAccountRefreshActionsDisabled", () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    "keeps both refresh actions disabled while either operation is active",
    (refreshingUsage, refreshingModels, expected) => {
      expect(
        areAccountRefreshActionsDisabled(refreshingUsage, refreshingModels)
      ).toBe(expected);
    }
  );
});

describe("reconnectableOAuthAgent", () => {
  it("offers reconnect for a failed local Codex OAuth account", () => {
    expect(reconnectableOAuthAgent(createAccount())).toBe("codex");
  });

  it("offers reconnect for a failed local Claude Code OAuth account", () => {
    expect(
      reconnectableOAuthAgent(createAccount({ modelType: "claude_code" }))
    ).toBe("claude_code");
  });

  it("accepts invalid health even before the mapped status becomes error", () => {
    expect(
      reconnectableOAuthAgent(
        createAccount({ status: "ready", healthStatus: "invalid" })
      )
    ).toBe("codex");
  });

  it("hides reconnect for a healthy OAuth account", () => {
    expect(
      reconnectableOAuthAgent(
        createAccount({ status: "ready", healthStatus: "valid", enabled: true })
      )
    ).toBeNull();
  });

  it("hides browser reauthentication for an API-key account", () => {
    expect(
      reconnectableOAuthAgent(
        createAccount({ authMethod: "api_key", hasApiKey: true })
      )
    ).toBeNull();
  });

  it("hides reconnect for providers without a reauthentication flow", () => {
    expect(
      reconnectableOAuthAgent(createAccount({ modelType: "kiro" }))
    ).toBeNull();
  });

  it("hides reconnect when the credential is not stored locally", () => {
    expect(
      reconnectableOAuthAgent(createAccount({ hasLocalKey: false }))
    ).toBeNull();
  });
});
