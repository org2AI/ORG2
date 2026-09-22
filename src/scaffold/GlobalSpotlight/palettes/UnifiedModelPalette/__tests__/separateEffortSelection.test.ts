// @vitest-environment jsdom
import { getDefaultStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import { separateEffortPillAtom } from "@src/store/session/separateEffortPillAtom";

import { useUnifiedModelPaletteSelection } from "../useUnifiedModelPaletteSelection";

vi.mock("@src/components/Message", () => ({ Message: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MODELS = ["gpt-5.5-low", "gpt-5.5-high", "gpt-5.4-mini-low"];
const account = {
  id: "key",
  name: "My key",
  modelType: "openai_api",
  status: "ready",
  hasKey: true,
  enabled: true,
  availableModels: MODELS,
  enabledModels: MODELS,
} as unknown as KeyVaultAccount;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => {
  getDefaultStore().set(separateEffortPillAtom, false);
});

async function mountPicker(currentModel: string) {
  const onConfigChange = vi.fn();
  let picker!: ReturnType<typeof useUnifiedModelPaletteSelection>;
  const root = createRoot(document.createElement("div"));
  function Probe() {
    const value = useUnifiedModelPaletteSelection({
      isOpen: false,
      isCliAgent: false,
      keyFirst: true,
      accountLookupSize: MODELS.length,
      accounts: [account],
      marketSources: [],
      listingAccounts: [account],
      listingMarketSources: [],
      advancedConfig: { model: currentModel, selectedAccountId: "key" },
      onConfigChange,
      recordRecent: vi.fn(),
      onClose: vi.fn(),
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
    dispose: () => act(() => root.unmount()),
  };
}

it.each([
  [false, "gpt-5.5-low"],
  [true, "gpt-5.5-high"],
])(
  "with separateEffortPill=%s a model pick launches %s",
  async (separate, expected) => {
    getDefaultStore().set(separateEffortPillAtom, separate);
    const mounted = await mountPicker("gpt-5.4-mini-high");
    try {
      mounted.picker.handleKeyModelSelect(account, "gpt-5.5-low");
      expect(mounted.onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({ model: expected })
      );
    } finally {
      mounted.dispose();
    }
  }
);

it("keeps an explicit in-place variant edit instead of the current effort", async () => {
  getDefaultStore().set(separateEffortPillAtom, true);
  const mounted = await mountPicker("gpt-5.5-high");
  try {
    mounted.picker.reselectVariant(
      {
        modelId: "gpt-5.5-high",
        sourceType: "own_key",
        accountId: "key",
        accountName: "My key",
        modelType: "openai_api",
      },
      "gpt-5.5-low"
    );
    expect(mounted.onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.5-low" })
    );
  } finally {
    mounted.dispose();
  }
});
