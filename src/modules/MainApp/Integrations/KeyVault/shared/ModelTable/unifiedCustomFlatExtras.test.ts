// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import type { ModelTableModelAlias } from "@src/types/modelTable";

import { useUnifiedCustomFlatHandlers } from "./unifiedCustomFlatExtras";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("tracks unfinished rows explicitly and accepts IDs beginning with new-", async () => {
  let state!: {
    customModels: string[];
    modelAliases: ModelTableModelAlias[];
    enabledModels: string[];
  };
  let handlers!: ReturnType<typeof useUnifiedCustomFlatHandlers>;
  function Harness() {
    const [customModels, onCustomModelsChange] = useState<string[]>([]);
    const [modelAliases, onModelAliasesChange] = useState<
      ModelTableModelAlias[]
    >([]);
    const [enabledModels, onEnabledModelsChange] = useState<string[]>([]);
    const currentState = { customModels, modelAliases, enabledModels };
    const result = useUnifiedCustomFlatHandlers({
      ...currentState,
      onCustomModelsChange,
      onModelAliasesChange,
      onEnabledModelsChange,
      visibleFlatRows: [],
    });
    useEffect(() => {
      state = currentState;
      handlers = result;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  act(() => handlers.handleAddModel());
  const draft = state.modelAliases[0];
  expect(draft.isDraft).toBe(true);
  act(() => handlers.handleModelNameChange(draft.alias, "new-provider/high"));
  expect(state.customModels).toEqual(["new-provider/high"]);
  expect(state.enabledModels).toEqual(["new-provider/high"]);
  expect(state.modelAliases[0]).toMatchObject({
    alias: "new-provider/high",
    rowId: draft.rowId,
    isDraft: false,
  });
  act(() => handlers.handleRemove("new-provider/high"));
  expect(state.customModels).toEqual([]);
  expect(state.enabledModels).toEqual([]);
  expect(state.modelAliases).toEqual([]);
  await act(async () => root.unmount());
});

it("refuses IDs the backend would reject and reports why", async () => {
  let state!: { customModels: string[]; modelAliases: ModelTableModelAlias[] };
  let handlers!: ReturnType<typeof useUnifiedCustomFlatHandlers>;
  function Harness() {
    const [customModels, onCustomModelsChange] = useState<string[]>([]);
    const [modelAliases, onModelAliasesChange] = useState<
      ModelTableModelAlias[]
    >([{ alias: "shared", displayName: "", icon: "openai" }]);
    const result = useUnifiedCustomFlatHandlers({
      customModels,
      modelAliases,
      onCustomModelsChange,
      onModelAliasesChange,
      visibleFlatRows: [],
      modelIdMessages: { invalid: "invalid-id", duplicate: "duplicate-id" },
    });
    useEffect(() => {
      state = { customModels, modelAliases };
      handlers = result;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  act(() => handlers.handleAddModel());
  const draft = state.modelAliases[1];
  act(() => handlers.handleModelNameChange(draft.alias, "my model"));
  expect(handlers.testError).toBe("invalid-id");
  expect(state.modelAliases[1]).toMatchObject({ isDraft: true });
  // Discovered models with an icon record count as taken IDs too.
  act(() => handlers.handleModelNameChange(draft.alias, "shared"));
  expect(handlers.testError).toBe("duplicate-id");
  act(() => handlers.handleModelNameChange(draft.alias, "deployment-high"));
  expect(handlers.testError).toBeNull();
  expect(state.customModels).toEqual(["deployment-high"]);
  await act(async () => root.unmount());
});
