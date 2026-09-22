// @vitest-environment jsdom
import React, { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KEY_SOURCE } from "@src/api/tauri/session";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";

import type { SourceOption } from "../types";
import { useUnifiedModelPaletteSelection } from "../useUnifiedModelPaletteSelection";

describe("useUnifiedModelPaletteSelection source dismissal", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  const onConfigChange = vi.fn();
  const recordRecent = vi.fn();
  const source: SourceOption = {
    id: "source-1",
    label: "Source",
    modelType: "openai" as SourceOption["modelType"],
    type: KEY_SOURCE.OWN,
  };

  function Harness({ closeOnSourceSelect }: { closeOnSourceSelect: boolean }) {
    const selection = useUnifiedModelPaletteSelection({
      isOpen: false,
      isCliAgent: false,
      keyFirst: false,
      accountLookupSize: 0,
      accounts: [],
      marketSources: [],
      listingAccounts: [],
      listingMarketSources: [],
      advancedConfig: { model: "" } as AdvancedConfig,
      onConfigChange,
      onClose,
      closeOnSourceSelect,
      recordRecent,
    });

    return createElement(
      React.Fragment,
      null,
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "model",
          onClick: () =>
            selection.handleModelSelect("model-1", "Model", ["model-1"]),
        },
        "Model"
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "source",
          onClick: () => selection.handleSourceSelect(source),
        },
        "Source"
      )
    );
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    onClose.mockClear();
    onConfigChange.mockClear();
    recordRecent.mockClear();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each([
    { closeOnSourceSelect: false, expectedCloseCalls: 0 },
    { closeOnSourceSelect: true, expectedCloseCalls: 1 },
  ])(
    "applies a source with closeOnSourceSelect=$closeOnSourceSelect",
    ({ closeOnSourceSelect, expectedCloseCalls }) => {
      act(() => root.render(createElement(Harness, { closeOnSourceSelect })));
      act(() =>
        container
          .querySelector<HTMLButtonElement>('[data-testid="model"]')!
          .click()
      );
      act(() =>
        container
          .querySelector<HTMLButtonElement>('[data-testid="source"]')!
          .click()
      );

      expect(onConfigChange).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledTimes(expectedCloseCalls);
    }
  );
});
