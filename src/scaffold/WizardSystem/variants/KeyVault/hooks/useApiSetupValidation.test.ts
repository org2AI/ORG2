// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { DEFAULT_WIZARD_DATA } from "../config";
import type { WizardData } from "../types";
import { useApiSetupValidation } from "./useApiSetupValidation";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mock = vi.hoisted(() => ({ validation: vi.fn() }));
vi.mock("@src/hooks/keyVault/useKeyValidation", () => ({
  useKeyValidation: mock.validation,
}));

it("validation preserves the latest manual edits, labels and enabled choices", async () => {
  mock.validation.mockReturnValue({});
  const onChange = vi.fn();
  function Harness({ data }: { data: WizardData }) {
    useApiSetupValidation({
      data,
      onChange,
      isCursor: false,
      isCodex: false,
      isClaudeCode: false,
      inputMode: "direct",
      resolvedCursorSessionToken: undefined,
      agentModelsRef: { current: [] },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const initial: WizardData = {
    ...DEFAULT_WIZARD_DATA,
    agent_type: "custom_api",
    raw_key_input: "fixture",
    extracted_base_url: "https://example.invalid/v1",
  };
  await act(async () => root.render(createElement(Harness, { data: initial })));
  const started = mock.validation.mock.lastCall?.[0].onValidationSuccess;
  const updated: WizardData = {
    ...initial,
    custom_models: ["new-valid", "disabled"],
    enabled_models: ["new-valid"],
    model_aliases: [
      { alias: "new-valid", displayName: "My model" },
      { alias: "disabled", displayName: "Disabled" },
    ],
  };
  await act(async () => root.render(createElement(Harness, { data: updated })));
  act(() =>
    started({ models: ["discovered"], modelContextLengths: {}, envVars: [] })
  );
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      custom_models: updated.custom_models,
      model_aliases: updated.model_aliases,
      enabled_models: ["new-valid"],
      extracted_base_url: initial.extracted_base_url,
      validated: true,
    })
  );
  onChange.mockClear();
  await act(async () =>
    root.render(
      createElement(Harness, {
        data: { ...updated, extracted_base_url: "https://changed.invalid/v1" },
      })
    )
  );
  act(() =>
    started({ models: ["stale"], modelContextLengths: {}, envVars: [] })
  );
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("drops enabled choices the new catalog no longer lists", async () => {
  mock.validation.mockReturnValue({});
  const onChange = vi.fn();
  function Harness({ data }: { data: WizardData }) {
    useApiSetupValidation({
      data,
      onChange,
      isCursor: false,
      isCodex: false,
      isClaudeCode: false,
      inputMode: "direct",
      resolvedCursorSessionToken: undefined,
      agentModelsRef: { current: [] },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  // First key validated: its defaults are enabled.
  const first: WizardData = {
    ...DEFAULT_WIZARD_DATA,
    agent_type: "openai",
    raw_key_input: "key-a",
    available_models: ["a-1", "a-2"],
    enabled_models: ["a-1", "manual"],
    custom_models: ["manual"],
  };
  await act(async () => root.render(createElement(Harness, { data: first })));
  const started = mock.validation.mock.lastCall?.[0].onValidationSuccess;
  act(() =>
    started({ models: ["b-1", "b-2"], modelContextLengths: {}, envVars: [] })
  );
  // The manual row survives; the previous key's default does not.
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      available_models: ["b-1", "b-2"],
      enabled_models: ["manual"],
    })
  );
  onChange.mockClear();
  const second: WizardData = { ...first, custom_models: [] };
  await act(async () => root.render(createElement(Harness, { data: second })));
  act(() =>
    started({ models: ["b-1", "b-2"], modelContextLengths: {}, envVars: [] })
  );
  // Nothing retained: fall back to the new catalog's defaults.
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ enabled_models: ["b-1", "b-2"] })
  );
  await act(async () => root.unmount());
});
