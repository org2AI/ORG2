// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import {
  USER_A,
  signedInStore,
} from "@src/features/MarketConnect/identity.test-utils";
import {
  type MarketProfileSource,
  prepareMarketProfileSource,
} from "@src/features/MarketConnect/marketProfiles";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";

import { useUnifiedModelPaletteSelection } from "../useUnifiedModelPaletteSelection";

vi.mock("@src/components/Message", () => ({ Message: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@src/features/MarketConnect/marketProfiles",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@src/features/MarketConnect/marketProfiles")
    >()),
    prepareMarketProfileSource: vi.fn(),
  })
);
const source: MarketProfileSource = {
  id: "market:test:codex",
  label: "Package",
  modelType: "codex",
  cliAgentType: "codex",
  modelIds: ["gpt", "gpt-high"],
  profile: {
    id: "market:test",
    label: "Package",
    connection: {
      identity_user_id: USER_A,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId: "pa_one",
    serviceId: "pkg_one",
    modelsByAgent: { codex: ["gpt"], claude_code: [] },
    expiresAt: null,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
async function mountPicker(closeOnSourceSelect?: boolean) {
  const onConfigChange = vi.fn(),
    recordRecent = vi.fn(),
    onClose = vi.fn();
  let picker!: ReturnType<typeof useUnifiedModelPaletteSelection>;
  const root = createRoot(document.createElement("div"));
  function Probe() {
    const value = useUnifiedModelPaletteSelection({
      isOpen: false,
      isCliAgent: true,
      keyFirst: false,
      accountLookupSize: 0,
      accounts: [],
      marketSources: [source],
      listingAccounts: [],
      listingMarketSources: [source],
      advancedConfig: {},
      onConfigChange,
      recordRecent,
      onClose,
      closeOnSourceSelect,
    });
    useEffect(() => {
      picker = value;
    }, [value]);
    return null;
  }
  await act(async () => {
    root.render(React.createElement(Probe));
  });
  return {
    get picker() {
      return picker;
    },
    onConfigChange,
    recordRecent,
    onClose,
    dispose: () => act(() => root.unmount()),
  };
}
it.each([false, true])(
  "does not commit Market preparation after logout with closeOnSourceSelect=%s",
  async (closeOnSourceSelect) => {
    const store = signedInStore();
    let finish!: (value: { credentialSource: string }) => void;
    vi.mocked(prepareMarketProfileSource).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const mounted = await mountPicker(closeOnSourceSelect);
    try {
      mounted.picker.handleMarketModelSelect(source, "gpt");
      store.set(org2CloudAuthAtom, null);
      await act(async () => {
        finish({ credentialSource: "market:late" });
      });
      expect(mounted.onConfigChange).not.toHaveBeenCalled();
      expect(mounted.recordRecent).not.toHaveBeenCalled();
      expect(mounted.onClose).not.toHaveBeenCalled();
    } finally {
      mounted.dispose();
    }
  }
);
it.each([undefined, false, true])(
  "commits an authorized Package with closeOnSourceSelect=%s",
  async (closeOnSourceSelect) => {
    signedInStore();
    let finish!: (value: { credentialSource: string }) => void;
    vi.mocked(prepareMarketProfileSource).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const mounted = await mountPicker(closeOnSourceSelect);
    try {
      mounted.picker.handleSourceSelect(
        {
          id: source.id,
          label: source.label,
          type: "own_key",
          modelType: source.modelType,
          marketSource: source,
        },
        "gpt"
      );
      expect(mounted.onConfigChange).not.toHaveBeenCalled();
      expect(mounted.recordRecent).not.toHaveBeenCalled();
      expect(mounted.onClose).not.toHaveBeenCalled();
      await act(async () => {
        finish({ credentialSource: "market:authorized" });
      });
      expect(mounted.onConfigChange).toHaveBeenCalledOnce();
      expect(mounted.onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt",
          marketProfileId: source.profile.id,
          credentialSource: "market:authorized",
          selectedAccountId: undefined,
        })
      );
      expect(mounted.recordRecent).toHaveBeenCalledOnce();
      expect(mounted.recordRecent).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "gpt",
          marketProfileId: source.profile.id,
          credentialSource: "market:authorized",
        })
      );
      expect(mounted.onClose).toHaveBeenCalledTimes(
        closeOnSourceSelect === false ? 0 : 1
      );
    } finally {
      mounted.dispose();
    }
  }
);
it.each([
  { closeOnSourceSelect: false, action: "recent", model: "gpt", closes: 1 },
  { closeOnSourceSelect: true, action: "recent", model: "gpt", closes: 1 },
  {
    closeOnSourceSelect: false,
    action: "variant",
    model: "gpt-high",
    closes: 0,
  },
  {
    closeOnSourceSelect: true,
    action: "variant",
    model: "gpt-high",
    closes: 0,
  },
])(
  "keeps Package $action dismissal independent of source-menu option $closeOnSourceSelect",
  async ({ closeOnSourceSelect, action, model, closes }) => {
    signedInStore();
    vi.mocked(prepareMarketProfileSource).mockResolvedValueOnce({
      credentialSource: "market:prepared",
    });
    const mounted = await mountPicker(closeOnSourceSelect);
    const entry: RecentModelEntry = {
      modelId: "gpt",
      sourceType: "own_key",
      modelType: source.modelType,
      cliAgentType: source.cliAgentType,
      marketProfileId: source.profile.id,
      accountName: source.label,
      credentialSource: "market:previous",
    };
    try {
      await act(async () => {
        if (action === "recent") mounted.picker.handleRecentSelect(entry);
        else mounted.picker.reselectVariant(entry, model);
      });
      expect(prepareMarketProfileSource).toHaveBeenCalledWith(source, model);
      expect(mounted.onConfigChange).toHaveBeenCalledOnce();
      expect(mounted.onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({
          model,
          marketProfileId: source.profile.id,
          credentialSource: "market:prepared",
        })
      );
      expect(mounted.recordRecent).toHaveBeenCalledOnce();
      expect(mounted.recordRecent).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: model,
          marketProfileId: source.profile.id,
          credentialSource: "market:prepared",
        })
      );
      expect(mounted.onClose).toHaveBeenCalledTimes(closes);
    } finally {
      mounted.dispose();
    }
  }
);
it("keeps ordinary Account Key selection usable while signed out of Cloud", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, null);
  const mounted = await mountPicker();
  try {
    mounted.picker.handleSourceSelect(
      {
        id: "key",
        label: "My API key",
        type: "own_key",
        modelType: "openai_api",
        accountId: "key",
      },
      "gpt"
    );
    expect(mounted.onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedAccountId: "key",
        model: "gpt",
        credentialSource: undefined,
      })
    );
    expect(mounted.recordRecent).toHaveBeenCalledOnce();
    expect(mounted.onClose).toHaveBeenCalledOnce();
    expect(prepareMarketProfileSource).not.toHaveBeenCalled();
  } finally {
    mounted.dispose();
  }
});
