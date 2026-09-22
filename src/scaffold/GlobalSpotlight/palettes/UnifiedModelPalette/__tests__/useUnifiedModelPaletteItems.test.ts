// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { MarketProfileSource } from "@src/features/MarketConnect/marketProfiles";
import { spotlightModelPinsAtom } from "@src/store/ui/spotlightPinsAtom";

import { useUnifiedModelPaletteItems } from "../useUnifiedModelPaletteItems";

it("retains a current Package's stable identity after it falls out of Recent", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const profileId = "market:00000000-0000-4000-8000-000000000001:pkg_one";
  const source: MarketProfileSource = {
    id: `${profileId}:codex`,
    label: "Renamed Package",
    modelType: "codex",
    cliAgentType: "codex",
    modelIds: ["gpt-5.6-luna"],
    profile: {
      id: profileId,
      label: "Renamed Package",
      connection: {
        identity_user_id: "00000000-0000-4000-8000-000000000001",
        workspace_id: "ws_owner",
        target: "org2",
      },
      entitlementWorkspaceId: "ws_purchase",
      entitlementId: "pa_one",
      serviceId: "pkg_one",
      modelsByAgent: { codex: ["gpt-5.6-luna"], claude_code: [] },
      expiresAt: null,
    },
  };
  const store = createStore();
  const root = createRoot(document.createElement("div"));
  const handleRecentSelect = vi.fn();
  let items!: ReturnType<typeof useUnifiedModelPaletteItems>;
  const props: Parameters<typeof useUnifiedModelPaletteItems>[0] = {
    advancedConfig: {
      model: "gpt-5.6-luna",
      credentialSource: "market:new-session",
      marketProfileId: profileId,
      selectedSourceLabel: "Old Package name",
      selectedSourceModelType: "codex",
      cliAgentType: "codex",
    },
    accounts: [],
    marketSources: [source],
    marketProfilesLoading: false,
    marketProfilesError: null,
    refreshMarketProfiles: vi.fn(),
    accountLookup: new Map(),
    orgiiModelSet: new Map(),
    orgiiCategoryIds: new Set(),
    orgiiPoolEnabled: false,
    isCliAgent: true,
    cliAgentType: "codex",
    recentEntries: [],
    sourceOptions: [],
    selectedModelId: null,
    selectedGroupModelIds: [],
    handleModelSelect: vi.fn(),
    handleSourceSelect: vi.fn(),
    handleRecentSelect,
    reselectVariant: vi.fn(),
    selectedKeyAccountId: null,
    handleKeySelect: vi.fn(),
    handleKeyModelSelect: vi.fn(),
    handleMarketModelSelect: vi.fn(),
    saveKey: vi.fn(),
    modelAliasVersion: 0,
    tCommon: (key) => key,
  };
  function Probe() {
    const value = useUnifiedModelPaletteItems(props);
    useEffect(() => {
      items = value;
    }, [value]);
    return null;
  }
  try {
    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(Probe))
      );
    });
    expect(items.recentItems).toHaveLength(1);
    items.recentItems[0].action?.();
    expect(handleRecentSelect).toHaveBeenCalledWith(
      expect.objectContaining({ marketProfileId: profileId })
    );
    await act(async () => {
      items.recentItems[0].data?.pinState?.onToggle();
    });
    expect(store.get(spotlightModelPinsAtom)).toHaveLength(1);
    expect(store.get(spotlightModelPinsAtom)[0].marketProfileId).toBe(
      profileId
    );
    expect(items.pinnedItems).toHaveLength(1);
    expect(items.recentItems).toHaveLength(0);
    expect(items.pinnedItems[0].data?.isCurrentSelection).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});
