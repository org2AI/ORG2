// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useUnifiedModelPaletteData } from "../useUnifiedModelPaletteData";

const mocks = vi.hoisted(() => ({ market: vi.fn(), accounts: vi.fn() }));
vi.mock("jotai", () => ({ useAtomValue: () => [], useSetAtom: () => vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/store/session/creatorStateAtom", () => ({
  cliAgentTypeAtom: {},
  dispatchCategoryAtom: {},
}));
vi.mock("@src/store/session/recentModelEntriesAtom", () => ({
  recentModelEntriesAtom: {},
  recordRecentEntry: vi.fn(),
}));
vi.mock("@src/components/Message", () => ({ default: { error: vi.fn() } }));
vi.mock("@src/features/MarketConnect/marketProfiles", () => ({
  useMarketExecutionProfiles: () => ({
    sources: [],
    loading: false,
    error: null,
    refresh: mocks.market,
  }),
}));
vi.mock("@src/hooks/keyVault", () => ({
  useKeyVault: () => ({ accounts: [], refresh: vi.fn(), saveKey: vi.fn() }),
}));
vi.mock("@src/hooks/models/nativeHarnessAccountModels", () => ({
  withNativeHarnessModels: () => [],
}));
vi.mock("@src/hooks/models/useAgentCompatibility", () => ({
  useAgentCompatibility: () => ({ registry: {} }),
  getCliCompatibleAccounts: () => [],
}));
vi.mock("@src/hooks/models/useModelAccountLookup", () => ({
  buildAccountLookup: () => new Map(),
}));
vi.mock("@src/hooks/models/useOrgiiPoolCategories", () => ({
  useOrgiiPoolCategories: () => ({
    orgiiCategories: [],
    orgiiModelSet: new Map(),
    orgiiCategoryIds: new Set(),
  }),
}));
vi.mock(
  "@src/modules/MainApp/Integrations/KeyVault/hooks/refreshAccountModels",
  () => ({ formatRefreshSummary: vi.fn(), refreshSummaryTone: vi.fn() })
);
vi.mock("../modelAccountRefresh", () => ({
  refreshModelAccounts: mocks.accounts,
}));

it("explicit model refresh refreshes the Market catalog and waits for both sources", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let finish!: () => void;
  mocks.market.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  mocks.accounts.mockResolvedValue(null);
  let current!: ReturnType<typeof useUnifiedModelPaletteData>;
  function Probe() {
    const value = useUnifiedModelPaletteData({
      isOpen: true,
      dispatchCategoryOverride: "rust_agent",
    });
    useEffect(() => {
      current = value;
    }, [value]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(React.createElement(Probe));
    });
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = current.refreshAllModels();
    });
    expect(mocks.market).toHaveBeenCalledTimes(1);
    expect(mocks.accounts).toHaveBeenCalledTimes(1);
    expect(current.refreshingAllModels).toBe(true);
    await act(async () => {
      finish();
      await refresh;
    });
    expect(current.refreshingAllModels).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
