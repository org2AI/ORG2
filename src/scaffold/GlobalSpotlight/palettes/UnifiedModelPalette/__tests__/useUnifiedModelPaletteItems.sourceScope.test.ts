// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { MarketProfileSource } from "@src/features/MarketConnect/marketProfiles";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { ModelAccountInfo } from "@src/hooks/models/types";
import { MODEL_SOURCE_SCOPE } from "@src/store/ui/spotlightModelSourceScopeAtom";

import {
  KEY_FIRST_KEY_TEST_ID,
  MARKET_PROFILE_TEST_ID,
} from "../keyFirstItems";
import { scopeListingSources } from "../modelSourceScope";
import { useUnifiedModelPaletteItems } from "../useUnifiedModelPaletteItems";

const KEY_MODEL = "gpt-5.6-sol";
const MARKET_MODEL = "gpt-5.6-luna";

const account: KeyVaultAccount = {
  id: "key-openai",
  name: "OpenAI",
  modelType: "codex",
  status: "ready",
  hasKey: true,
  hasApiKey: true,
  hasSessionToken: false,
  hasLocalKey: true,
  isListed: false,
  enabled: true,
  availableModels: [KEY_MODEL],
  enabledModels: [KEY_MODEL],
} as KeyVaultAccount;

const marketSource: MarketProfileSource = {
  id: "market:00000000-0000-4000-8000-000000000001:pkg_one:codex",
  label: "Bought Package",
  modelType: "codex",
  cliAgentType: "codex",
  modelIds: [MARKET_MODEL],
  profile: {
    id: "market:00000000-0000-4000-8000-000000000001:pkg_one",
    label: "Bought Package",
    connection: {
      identity_user_id: "00000000-0000-4000-8000-000000000001",
      workspace_id: "ws_owner",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId: "pa_one",
    serviceId: "pkg_one",
    modelsByAgent: { codex: [MARKET_MODEL], claude_code: [] },
    expiresAt: null,
  },
};

function lookupFor(modelIds: string[]): Map<string, ModelAccountInfo> {
  return new Map(
    modelIds.map((modelId) => [
      modelId,
      { totalKeys: 1, agentTypes: ["codex"] },
    ])
  );
}

/** Render the items hook with the browse columns narrowed to `scope`. */
async function renderItems(
  scope:
    | (typeof MODEL_SOURCE_SCOPE)[keyof typeof MODEL_SOURCE_SCOPE]
    | undefined
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const listing = scopeListingSources([account], [marketSource], scope);
  const listedModelIds = [
    ...listing.accounts.flatMap((entry) => entry.availableModels ?? []),
    ...listing.marketSources.flatMap((source) => source.modelIds),
  ];
  const props: Parameters<typeof useUnifiedModelPaletteItems>[0] = {
    advancedConfig: {},
    accounts: [account],
    marketSources: [marketSource],
    listingAccounts: listing.accounts,
    listingMarketSources: listing.marketSources,
    sourceScope: scope,
    marketProfilesLoading: false,
    marketProfilesError: null,
    refreshMarketProfiles: vi.fn(),
    accountLookup: lookupFor(listedModelIds),
    fullModelLookup: lookupFor([KEY_MODEL, MARKET_MODEL]),
    orgiiModelSet: new Map(),
    orgiiCategoryIds: new Set(),
    orgiiPoolEnabled: false,
    isCliAgent: true,
    cliAgentType: "codex",
    recentEntries: [
      {
        modelId: KEY_MODEL,
        sourceType: "own_key",
        accountId: account.id,
        accountName: account.name,
        modelType: "codex",
      },
    ],
    sourceOptions: [],
    selectedModelId: null,
    selectedGroupModelIds: [],
    handleModelSelect: vi.fn(),
    handleSourceSelect: vi.fn(),
    handleRecentSelect: vi.fn(),
    reselectVariant: vi.fn(),
    selectedKeyAccountId: null,
    handleKeySelect: vi.fn(),
    handleKeyModelSelect: vi.fn(),
    handleMarketModelSelect: vi.fn(),
    saveKey: vi.fn(),
    modelAliasVersion: 0,
    tCommon: (key) => key,
  };

  const root = createRoot(document.createElement("div"));
  let items!: ReturnType<typeof useUnifiedModelPaletteItems>;
  function Probe() {
    const value = useUnifiedModelPaletteItems(props);
    useEffect(() => {
      items = value;
    }, [value]);
    return null;
  }
  await act(async () => {
    root.render(
      React.createElement(
        Provider,
        { store: createStore() },
        React.createElement(Probe)
      )
    );
  });
  return { items, unmount: () => act(() => root.unmount()) };
}

function testIds(items: { data?: Record<string, unknown> }[]): unknown[] {
  return items.map((item) => item.data?.testId);
}

it("lists both kinds of source without a scope", async () => {
  const { items, unmount } = await renderItems(undefined);
  try {
    expect(testIds(items.keyItems)).toEqual([
      KEY_FIRST_KEY_TEST_ID,
      MARKET_PROFILE_TEST_ID,
    ]);
    expect(items.allModelItems.map((item) => item.data?.modelId)).toEqual([
      KEY_MODEL,
      MARKET_MODEL,
    ]);
  } finally {
    await unmount();
  }
});

it("lists only Key Vault keys under the keys scope", async () => {
  const { items, unmount } = await renderItems(MODEL_SOURCE_SCOPE.KEYS);
  try {
    expect(testIds(items.keyItems)).toEqual([KEY_FIRST_KEY_TEST_ID]);
    expect(items.allModelItems.map((item) => item.data?.modelId)).toEqual([
      KEY_MODEL,
    ]);
  } finally {
    await unmount();
  }
});

it("lists only Market packages under the market scope, and keeps Recent whole", async () => {
  const { items, unmount } = await renderItems(MODEL_SOURCE_SCOPE.MARKET);
  try {
    expect(testIds(items.keyItems)).toEqual([MARKET_PROFILE_TEST_ID]);
    expect(items.allModelItems.map((item) => item.data?.modelId)).toEqual([
      MARKET_MODEL,
    ]);
    // The browse filter must not strand the key-backed model the user just
    // used: Recent rows (and the apply path behind them) stay unscoped.
    expect(items.recentItems.map((item) => item.data?.modelId)).toEqual([
      KEY_MODEL,
    ]);
  } finally {
    await unmount();
  }
});
