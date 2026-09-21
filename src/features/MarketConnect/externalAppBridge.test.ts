// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  configureExternalMarketCatalog,
  modelsForExternalTarget,
} from "./externalAppBridge";
import { USER_A, signedInStore } from "./identity.test-utils";
import type { MarketExecutionProfile } from "./marketProfiles";

const { status, configure, authorize } = vi.hoisted(() => ({
  status: vi.fn(),
  configure: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { agentOrgs: { connections: { status }, managedConfig: {} } },
}));
vi.mock("./rpc", () => ({
  configureMarketCatalog: configure,
  configureMarketProfile: vi.fn(),
}));
vi.mock("./usageAuthorization", () => ({ authorizedProfile: authorize }));

const profiles: MarketExecutionProfile[] = ["first", "second"].map((id) => ({
  id,
  label: `Package ${id}`,
  connection: {
    identity_user_id: USER_A,
    workspace_id: "ws_anchor",
    target: "org2",
    phase: "authorized",
  },
  entitlementWorkspaceId: "ws_purchase",
  entitlementId: `pa_${id}`,
  serviceId: id,
  modelsByAgent: { claude_code: ["claude-shared"], codex: ["gpt-shared"] },
  expiresAt: null,
}));
beforeEach(() => {
  signedInStore();
  vi.clearAllMocks();
  status.mockResolvedValue({
    installed: true,
    config: {
      supported: true,
      conflict: false,
      targetFiles: [{ id: "config", currentHash: "unchanged" }],
    },
  });
  authorize.mockImplementation(async (profile) => profile);
  configure.mockResolvedValue({ selection: "market-app:catalog" });
});
it("authorizes every Package once and applies one catalog with an explicit default purchase", async () => {
  await configureExternalMarketCatalog(
    profiles,
    "codex",
    "second",
    "gpt-shared"
  );
  expect(authorize.mock.calls).toEqual([
    [profiles[0], "gpt-shared"],
    [profiles[1], "gpt-shared"],
  ]);
  expect(configure).toHaveBeenCalledExactlyOnceWith(
    profiles,
    "codex",
    1,
    "gpt-shared",
    { config: "unchanged" }
  );
});
it("does not apply a partial native catalog when any usage consent fails", async () => {
  authorize
    .mockResolvedValueOnce(profiles[0])
    .mockRejectedValueOnce(new Error("usage_authorization_cancelled"));
  await expect(
    configureExternalMarketCatalog(profiles, "codex", "first", "gpt-shared")
  ).rejects.toThrow("usage_authorization_cancelled");
  expect(configure).not.toHaveBeenCalled();
});
it("rejects different identities, duplicate selections and absent defaults before consent", async () => {
  const other = {
    ...profiles[1],
    connection: { ...profiles[1].connection, identity_user_id: "other" },
  };
  await expect(
    configureExternalMarketCatalog(
      [profiles[0], other],
      "codex",
      "first",
      "gpt-shared"
    )
  ).rejects.toThrow("market_identity_mismatch");
  await expect(
    configureExternalMarketCatalog(
      [profiles[0], profiles[0]],
      "codex",
      "first",
      "gpt-shared"
    )
  ).rejects.toThrow("invalid_package_selection");
  await expect(
    configureExternalMarketCatalog(profiles, "codex", "missing", "gpt-shared")
  ).rejects.toThrow("workspace_not_supported");
  expect(authorize).not.toHaveBeenCalled();
  expect(configure).not.toHaveBeenCalled();
});

it("excludes unavailable models and unsupported native targets before authorizing", async () => {
  const profile: MarketExecutionProfile = {
    ...profiles[0],
    managed: {
      service_id: "pkg_first",
      title: "First",
      version_id: "pv_first",
      requires_confirmation: false,
      models: [
        {
          model: "claude-shared",
          protocol: "anthropic_messages",
          clients: ["org2", "claude_code"],
          availability: "available",
          pricing: {},
        },
      ],
      access: null,
    },
  };
  expect(modelsForExternalTarget(profile, "claude_code")).toEqual([
    "claude-shared",
  ]);
  expect(modelsForExternalTarget(profile, "claude_desktop")).toEqual([]);
  await expect(
    configureExternalMarketCatalog(
      [profile],
      "claude_desktop",
      profile.id,
      "claude-shared"
    )
  ).rejects.toThrow("workspace_not_supported");
  profile.managed!.models[0].availability = "unavailable";
  expect(modelsForExternalTarget(profile, "claude_code")).toEqual([]);
  expect(authorize).not.toHaveBeenCalled();
  expect(configure).not.toHaveBeenCalled();
});

it("does not configure a native catalog when logout happens during client status lookup", async () => {
  let finish!: (value: unknown) => void;
  status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const configuring = configureExternalMarketCatalog(
    profiles,
    "codex",
    profiles[0].id,
    "gpt-shared"
  );
  getInstrumentedStore().set(org2CloudAuthAtom, null);
  finish({
    installed: true,
    config: { supported: true, conflict: false, targetFiles: [] },
  });
  await expect(configuring).rejects.toThrow("market_identity_mismatch");
  expect(authorize).not.toHaveBeenCalled();
  expect(configure).not.toHaveBeenCalled();
});
