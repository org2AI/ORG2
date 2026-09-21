// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { MARKET_PROFILES_CHANGED_EVENT } from "./events";
import { USER_B, authFor, signedInStore } from "./identity.test-utils";
import type { MarketExecutionProfile } from "./marketProfiles";
import { activateManagedService } from "./rpc";
import {
  USAGE_AUTHORIZATION_EVENT,
  type UsagePrompt,
  authorizedProfile,
} from "./usageAuthorization";

vi.mock("./rpc", () => ({ activateManagedService: vi.fn() }));
const access = {
  access_id: "pa_example",
  service_id: "pkg_example",
  workspace_id: "ws_example",
  status: "active" as const,
  budget_usd6: null,
  billing_mode: "wallet" as const,
  revision: 1,
};
const profile = (): MarketExecutionProfile => ({
  id: "market:example",
  label: "Example package",
  connection: {
    identity_user_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "ws_connection",
    target: "org2",
  },
  entitlementWorkspaceId: "ws_connection",
  entitlementId: "pkg_example",
  serviceId: "pkg_example",
  modelsByAgent: {
    claude_code: ["example-messages"],
    codex: ["example-responses"],
  },
  expiresAt: null,
  managed: {
    service_id: "pkg_example",
    title: "Example package",
    version_id: "pv_example",
    requires_confirmation: true,
    wallet_billing_supported: true,
    access: null,
    models: [
      {
        model: "example-messages",
        protocol: "anthropic_messages",
        clients: ["org2", "claude_code"],
        pricing: {},
        availability: "available",
      },
      {
        model: "example-responses",
        protocol: "openai_responses",
        clients: ["org2", "codex"],
        pricing: {},
        availability: "available",
      },
    ],
  },
});
afterEach(() => {
  vi.clearAllMocks();
});

it("confirms all included models once and reuses the same access when switching models", async () => {
  const selected = profile();
  const prompts: UsagePrompt[] = [];
  const confirm = (event: Event) => {
    const prompt = (event as CustomEvent<UsagePrompt>).detail;
    prompts.push(prompt);
    prompt.resolve(true);
  };
  window.addEventListener(USAGE_AUTHORIZATION_EVENT, confirm);
  vi.mocked(activateManagedService).mockResolvedValue(access);
  try {
    const enabled = await authorizedProfile(selected, "example-messages");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.service.models.map((m) => m.model)).toEqual([
      "example-messages",
      "example-responses",
    ]);
    expect(prompts[0]).not.toHaveProperty("model");
    expect(activateManagedService).toHaveBeenCalledExactlyOnceWith(
      selected.connection,
      selected.managed
    );
    const switched = await authorizedProfile(enabled, "example-responses");
    expect(switched).toBe(enabled);
    expect(switched.entitlementId).toBe(access.access_id);
    expect(prompts).toHaveLength(1);
    expect(activateManagedService).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(USAGE_AUTHORIZATION_EVENT, confirm);
  }
});

it("cancelling a package confirmation grants access to none of its models", async () => {
  const selected = profile();
  selected.managed!.access = access;
  const cancel = (event: Event) =>
    (event as CustomEvent<UsagePrompt>).detail.resolve(false);
  window.addEventListener(USAGE_AUTHORIZATION_EVENT, cancel);
  try {
    for (const model of selected.managed!.models) {
      await expect(authorizedProfile(selected, model.model)).rejects.toThrow(
        "usage_authorization_cancelled"
      );
    }
    expect(activateManagedService).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(USAGE_AUTHORIZATION_EVENT, cancel);
  }
});

it("keeps availability a call constraint rather than a per-model activation", async () => {
  const enabled = profile();
  enabled.managed!.access = access;
  enabled.managed!.requires_confirmation = false;
  enabled.managed!.models[1]!.availability = "temporarily_unavailable";
  await expect(authorizedProfile(enabled, "example-responses")).rejects.toThrow(
    "model_temporarily_unavailable"
  );
  await expect(authorizedProfile(enabled, "example-messages")).resolves.toBe(
    enabled
  );
  expect(activateManagedService).not.toHaveBeenCalled();
});

beforeEach(() => {
  signedInStore();
});

it("cancels pending confirmation immediately on logout without activation", async () => {
  let prompt!: UsagePrompt;
  const show = (event: Event) => {
    prompt = (event as CustomEvent<UsagePrompt>).detail;
  };
  window.addEventListener(USAGE_AUTHORIZATION_EVENT, show);
  try {
    const loading = authorizedProfile(profile(), "example-messages");
    getInstrumentedStore().set(org2CloudAuthAtom, null);
    prompt.resolve(true);
    await expect(loading).rejects.toThrow("usage_authorization_cancelled");
    expect(activateManagedService).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(USAGE_AUTHORIZATION_EVENT, show);
  }
});
it("does not publish an activation that completes after logout", async () => {
  let finish!: (value: typeof access) => void;
  vi.mocked(activateManagedService).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const confirm = (event: Event) =>
    (event as CustomEvent<UsagePrompt>).detail.resolve(true);
  const changed = vi.fn();
  window.addEventListener(USAGE_AUTHORIZATION_EVENT, confirm);
  window.addEventListener(MARKET_PROFILES_CHANGED_EVENT, changed);
  try {
    const loading = authorizedProfile(profile(), "example-messages");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    getInstrumentedStore().set(org2CloudAuthAtom, null);
    finish(access);
    await expect(loading).rejects.toThrow("market_identity_mismatch");
    expect(changed).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(USAGE_AUTHORIZATION_EVENT, confirm);
    window.removeEventListener(MARKET_PROFILES_CHANGED_EVENT, changed);
  }
});

it("preserves a pending confirmation across same-user token refresh", async () => {
  let prompt!: UsagePrompt;
  const show = (event: Event) => {
    prompt = (event as CustomEvent<UsagePrompt>).detail;
  };
  window.addEventListener(USAGE_AUTHORIZATION_EVENT, show);
  vi.mocked(activateManagedService).mockResolvedValue(access);
  try {
    const loading = authorizedProfile(profile(), "example-messages");
    getInstrumentedStore().set(org2CloudAuthAtom, {
      ...authFor(),
      accessToken: "fresh",
    });
    prompt.resolve(true);
    expect((await loading).entitlementId).toBe(access.access_id);
  } finally {
    window.removeEventListener(USAGE_AUTHORIZATION_EVENT, show);
  }
});

it("lets the new owner confirm while an old activation drains, without letting the old completion release the new prompt", async () => {
  let finish!: (value: typeof access) => void;
  vi.mocked(activateManagedService).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const prompts: UsagePrompt[] = [];
  const show = (event: Event) => {
    const prompt = (event as CustomEvent<UsagePrompt>).detail;
    prompts.push(prompt);
    if (prompts.length === 1) prompt.resolve(true);
  };
  window.addEventListener(USAGE_AUTHORIZATION_EVENT, show);
  try {
    const old = authorizedProfile(profile(), "example-messages");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    getInstrumentedStore().set(org2CloudAuthAtom, authFor(USER_B));
    const nextProfile = profile();
    nextProfile.connection.identity_user_id = USER_B;
    const next = authorizedProfile(nextProfile, "example-messages");
    expect(prompts).toHaveLength(2);
    finish(access);
    await expect(old).rejects.toThrow("market_identity_mismatch");
    await expect(
      authorizedProfile(nextProfile, "example-messages")
    ).rejects.toThrow("usage_authorization_in_progress");
    prompts[1].resolve(false);
    await expect(next).rejects.toThrow("usage_authorization_cancelled");
  } finally {
    window.removeEventListener(USAGE_AUTHORIZATION_EVENT, show);
  }
});
