import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getFullKey,
  getOAuthModelCatalog,
  refreshKeyModelCatalog,
  refreshOauthToken,
  updateKeyHealth,
} from "@src/api/services/keyValidation";
import type { KeyVaultAccount } from "@src/hooks/keyVault";

import {
  refreshAccountModels,
  refreshAllAccountModels,
} from "./refreshAccountModels";

vi.mock("@src/api/services/keyValidation", () => ({
  getFullKey: vi.fn(),
  getOAuthModelCatalog: vi.fn(),
  refreshKeyModelCatalog: vi.fn(),
  refreshOauthToken: vi.fn(),
  updateKeyHealth: vi.fn(),
  getCursorNativeModels: vi.fn(),
  validateKey: vi.fn(),
}));
const account: KeyVaultAccount = {
  id: "account",
  name: "Fixture account",
  status: "ready",
  hasLocalKey: true,
  isListed: false,
  hasKey: true,
  hasApiKey: false,
  hasSessionToken: true,
  enabled: true,
  modelType: "codex",
  authMethod: "oauth",
  availableModels: ["stale-ui-model"],
  enabledModels: [],
};
const snapshot = {
  id: "account",
  agent_type: "codex",
  name: null,
  api_key: null,
  session_token: "fixture-token",
  base_url: null,
  env_vars: {},
  account_metadata: {},
  available_models: ["model"],
  auth_method: "oauth",
  credential_generation: 3,
  model_catalog_generation: 7,
} as const;
const catalog = {
  models: ["model", "next"],
  modelContextLengths: { model: 10000 },
  defaultEnabledModels: ["next"],
  modelVariants: [
    {
      model: "opaque-effort",
      base_model: "model",
      reasoning: "high",
      fast: false,
    },
  ],
  defaultVariants: [{ base_model: "model", model: "opaque-effort" }],
  source: "live",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFullKey).mockResolvedValue({
    ...snapshot,
    available_models: [...snapshot.available_models],
    auth_method: "oauth",
  });
  vi.mocked(getOAuthModelCatalog).mockResolvedValue({
    ...catalog,
    models: [...catalog.models],
    defaultEnabledModels: [...catalog.defaultEnabledModels],
    modelVariants: [...catalog.modelVariants],
    defaultVariants: [...catalog.defaultVariants],
  });
  vi.mocked(refreshKeyModelCatalog).mockResolvedValue({
    available_models: ["model", "next", "manual"],
  } as Awaited<ReturnType<typeof refreshKeyModelCatalog>>);
});

describe("refreshAccountModels", () => {
  it("commits the full discovered metadata and uses persisted readback without replaying UI enablement", async () => {
    await expect(refreshAccountModels(account)).resolves.toEqual({
      models: ["model", "next", "manual"],
      previousModels: ["model"],
    });
    expect(refreshKeyModelCatalog).toHaveBeenCalledExactlyOnceWith("account", {
      expectedCredentialGeneration: 3,
      expectedCatalogGeneration: 7,
      availableModels: ["model", "next"],
      modelVariants: catalog.modelVariants,
      defaultVariants: catalog.defaultVariants,
      modelContextLengths: { model: 10000 },
    });
    expect(updateKeyHealth).not.toHaveBeenCalled();
  });

  it("single-flights simultaneous entry points and releases state after success", async () => {
    const first = refreshAccountModels(account);
    const second = refreshAccountModels(account);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(getOAuthModelCatalog).toHaveBeenCalledTimes(1);
    await refreshAccountModels(account);
    expect(getOAuthModelCatalog).toHaveBeenCalledTimes(2);
  });

  it("preserves the previous catalog on fallback and empty discovery, then allows retry", async () => {
    vi.mocked(getOAuthModelCatalog).mockResolvedValueOnce({
      ...catalog,
      models: [],
      defaultEnabledModels: [],
      modelVariants: [],
      defaultVariants: [],
    });
    await expect(refreshAccountModels(account)).rejects.toThrow(
      "empty model list"
    );
    expect(refreshKeyModelCatalog).not.toHaveBeenCalled();
    await refreshAccountModels(account);
    expect(refreshKeyModelCatalog).toHaveBeenCalledTimes(1);
  });

  it("does not replace last-known-good data with a bootstrap fallback", async () => {
    vi.mocked(getOAuthModelCatalog).mockResolvedValueOnce({
      ...catalog,
      source: "fallback",
      models: [...catalog.models],
      defaultEnabledModels: [...catalog.defaultEnabledModels],
      modelVariants: [...catalog.modelVariants],
      defaultVariants: [...catalog.defaultVariants],
    });
    await expect(refreshAccountModels(account)).rejects.toMatchObject({
      kind: "transient",
    });
    expect(refreshKeyModelCatalog).not.toHaveBeenCalled();
  });

  it("re-reads the credential snapshot after one OAuth retry", async () => {
    vi.mocked(getOAuthModelCatalog).mockRejectedValueOnce(
      new Error("HTTP 401")
    );
    vi.mocked(getFullKey).mockResolvedValueOnce({
      ...snapshot,
      available_models: [...snapshot.available_models],
      auth_method: "oauth",
    });
    vi.mocked(getFullKey).mockResolvedValueOnce({
      ...snapshot,
      available_models: [...snapshot.available_models],
      auth_method: "oauth",
      credential_generation: 4,
    });
    await refreshAccountModels(account);
    expect(refreshOauthToken).toHaveBeenCalledExactlyOnceWith("account");
    expect(refreshKeyModelCatalog).toHaveBeenCalledWith(
      "account",
      expect.objectContaining({ expectedCredentialGeneration: 4 })
    );
  });

  it("does not turn a retry's network failure into an unguarded invalid-account write", async () => {
    vi.mocked(getOAuthModelCatalog)
      .mockRejectedValueOnce(new Error("HTTP 401"))
      .mockRejectedValueOnce(new Error("network unavailable"));
    await expect(refreshAccountModels(account)).rejects.toMatchObject({
      kind: "transient",
    });
    expect(refreshKeyModelCatalog).not.toHaveBeenCalled();
    expect(updateKeyHealth).not.toHaveBeenCalled();
    await refreshAccountModels(account);
    expect(refreshKeyModelCatalog).toHaveBeenCalledTimes(1);
  });

  it("reports a stale commit as failure and preserves other accounts' successes", async () => {
    vi.mocked(refreshKeyModelCatalog).mockRejectedValueOnce(
      new Error("Account changed")
    );
    const summary = await refreshAllAccountModels([
      account,
      { ...account, id: "other" },
    ]);
    expect(summary).toEqual({ total: 2, failed: 1, added: 2, removed: 0 });
  });
});
