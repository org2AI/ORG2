// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

import {
  resolveDefaultConversationTarget,
  resolvePickedConversationRuntimeTarget,
} from "@src/engines/ChatPanel/conversationTargetSelection";
import { localConversationTargetFromSession } from "@src/engines/ChatPanel/hooks/conversationTargetBinding/conversationSourceResolution";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { resolveAgentRuntimeSelection } from "@src/features/SessionCreator/agentRuntimeConfig";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { signedInStore } from "./identity.test-utils";
import {
  adaptMarketEntries,
  marketSourceModelType,
  marketSourcesForAgent,
  prepareMarketProfileSource,
} from "./marketProfiles";
import { type Connection, type Entry, prepareSessionSource } from "./rpc";

vi.mock("./rpc", () => ({
  prepareSessionSource: vi.fn(),
  activateManagedService: vi.fn(),
}));

const connection: Connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_catalog",
  target: "org2",
};
const entry: Entry = {
  workspace_id: "ws_purchase",
  entitlement_id: "pa_purchase",
  service_id: "package",
  service_name: "Mixed package",
  models: ["sonnet", "gpt"],
  models_by_agent: { claude: ["sonnet"], codex: ["gpt"] },
  status: "active",
  expires_at: null,
  managed: {
    service_id: "package",
    title: "Mixed package",
    version_id: "v1",
    requires_confirmation: false,
    access: {
      access_id: "pa_purchase",
      service_id: "package",
      workspace_id: "ws_purchase",
      status: "active",
      revision: 1,
      billing_mode: "wallet",
      budget_usd6: null,
    },
    models: [
      {
        model: "sonnet",
        protocol: "anthropic_messages",
        clients: ["org2", "claude_code"],
        pricing: {},
        availability: "available",
      },
      {
        model: "gpt",
        protocol: "openai_responses",
        clients: ["org2", "codex"],
        pricing: {},
        availability: "available",
      },
      {
        model: "cli-only",
        protocol: "openai_responses",
        clients: ["codex"],
        pricing: {},
        availability: "available",
      },
    ],
  },
};
const selection = {
  category: "rust_agent",
  targetKind: "agent",
  agentDefinitionId: "builtin:sde",
  agentName: "SDE",
} as const;
const registry = { agents: [], apiProviders: [] };

it("projects an enabled mixed-protocol purchase into SDE, prepares its source, and restores the exact target", async () => {
  const profiles = adaptMarketEntries(connection, [entry]);
  const sources = marketSourcesForAgent(profiles, "rust_agent");
  expect(sources).toHaveLength(1);
  const source = sources[0];
  expect(source.modelIds).toEqual(["sonnet", "gpt"]);
  expect(source.cliAgentType).toBeUndefined();
  expect(marketSourceModelType(source, "sonnet")).toBe("anthropic_api");
  expect(marketSourceModelType(source, "gpt")).toBe("openai_api");
  vi.mocked(prepareSessionSource).mockResolvedValue({
    credential_source: "market:purchase-responses",
  });
  const prepared = await prepareMarketProfileSource(source, "gpt");
  expect(prepareSessionSource).toHaveBeenCalledWith(
    connection,
    "ws_purchase",
    "pa_purchase",
    "rust_agent",
    "gpt"
  );
  const config = { ...prepared, model: "gpt", keySource: "own_key" as const };
  const picked = resolvePickedConversationRuntimeTarget({
    selection,
    config,
    workspaceRepoPath: "/repo",
    accounts: [],
    registry,
    nativeCliTargets: [],
  });
  expect(picked).toEqual({
    agentDefinitionId: "builtin:sde",
    credentialSource: "market:purchase-responses",
    model: "gpt",
    workspaceRepoPath: "/repo",
  });
  const restored = localConversationTargetFromSession({
    agentDefinitionId: picked?.agentDefinitionId,
    credentialSource: picked?.credentialSource,
    model: picked?.model,
    repoPath: "/repo",
  });
  expect(restored).toEqual(picked);
  expect(
    resolveDefaultConversationTarget({
      preferredTarget: restored,
      initialTarget: null,
      workspaceRepoPath: "/repo",
      accounts: [],
      registry,
      nativeCliTargets: [],
    })
  ).toEqual(picked);
});

it("does not expose legacy purchases to SDE or allow native-incompatible models", async () => {
  const legacy = { ...entry, managed: undefined };
  expect(
    marketSourcesForAgent(
      adaptMarketEntries(connection, [legacy]),
      "rust_agent"
    )
  ).toEqual([]);
  expect(
    marketSourcesForAgent(
      adaptMarketEntries(connection, [legacy]),
      "claude_code"
    )[0].modelIds
  ).toEqual(["sonnet"]);
  const [source] = marketSourcesForAgent(
    adaptMarketEntries(connection, [entry]),
    "rust_agent"
  );
  await expect(prepareMarketProfileSource(source, "cli-only")).rejects.toThrow(
    "does not support model"
  );
});

it("never turns a malformed or incompatible dynamic source into ambient Claude credentials", () => {
  for (const config of [
    { credentialSource: "market:sde", model: "gpt" },
    {
      credentialSource: " market:bad",
      model: "gpt",
      cliAgentType: "claude_code" as const,
    },
    {
      credentialSource: "market:both",
      selectedAccountId: "account",
      model: "gpt",
      cliAgentType: "claude_code" as const,
    },
  ]) {
    expect(
      resolveAgentRuntimeSelection({
        selection: { category: "cli_agent", cliAgentType: "claude_code" },
        candidates: [config],
        accounts: [],
        registry,
        allowHosted: false,
        allowAmbientClaude: true,
      })
    ).toEqual({ status: "needs_model_picker" });
  }
});

beforeEach(() => {
  signedInStore();
});

it("rejects a late model preparation after the owner logs out", async () => {
  const [source] = marketSourcesForAgent(
    adaptMarketEntries(connection, [entry]),
    "rust_agent"
  );
  let finish!: (value: { credential_source: string }) => void;
  vi.mocked(prepareSessionSource).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const preparing = prepareMarketProfileSource(source, "gpt");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  getInstrumentedStore().set(org2CloudAuthAtom, null);
  finish({ credential_source: "market:late" });
  await expect(preparing).rejects.toThrow("market_identity_mismatch");
});
