// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCredentialImport } from "../useCredentialImport";

const mocks = vi.hoisted(() => ({
  importCredentialSuggestions: vi.fn(),
  listCredentialSuggestions: vi.fn(),
  loadAvailableAgents: vi.fn(),
  getAvailableApiProviders: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));
vi.mock("@src/api/services/keyValidation", () => ({
  importCredentialSuggestions: mocks.importCredentialSuggestions,
  listCredentialSuggestions: mocks.listCredentialSuggestions,
}));
vi.mock("@src/api/services/availableAgents", () => ({
  loadAvailableAgents: mocks.loadAvailableAgents,
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    validation: {
      getAvailableApiProviders: mocks.getAvailableApiProviders,
    },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.loadAvailableAgents.mockResolvedValue([
    { name: "claude", displayName: "Claude Code" },
  ]);
  mocks.getAvailableApiProviders.mockResolvedValue([]);
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("useCredentialImport success state", () => {
  it("keeps the imported credential name visible after detection removes the row", async () => {
    const suggestion = {
      id: "claude-oauth",
      agentType: "claude",
      authMethod: "oauth",
      sourceKind: "oauth_store",
      sourceLabel: "Claude Code login",
      alreadyImported: false,
    } as const;
    mocks.listCredentialSuggestions
      .mockResolvedValueOnce([suggestion])
      .mockResolvedValueOnce([{ ...suggestion, alreadyImported: true }]);
    mocks.importCredentialSuggestions.mockResolvedValue({
      items: [
        {
          id: suggestion.id,
          agentType: suggestion.agentType,
          sourceLabel: suggestion.sourceLabel,
          status: "imported",
          keyId: "key-1",
        },
      ],
    });
    const onRefresh = vi.fn();
    const onCompleted = vi.fn();
    const resultRef = renderCredentialImport({ onRefresh, onCompleted });

    await vi.waitFor(() =>
      expect(resultRef.current.importableItems).toHaveLength(1)
    );
    act(() =>
      resultRef.current.handleRowClick(resultRef.current.importableItems[0])
    );
    await act(async () => resultRef.current.handleImport());

    expect(resultRef.current.importSuccess).toEqual({
      displayNames: ["Claude Code"],
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(resultRef.current.importableItems).toHaveLength(0)
    );
    expect(resultRef.current.importSuccess).toEqual({
      displayNames: ["Claude Code"],
    });
  });
});

function renderCredentialImport(options: {
  onRefresh: () => void;
  onCompleted: () => void;
}) {
  const capture =
    vi.fn<(value: ReturnType<typeof useCredentialImport>) => void>();
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    capture(useCredentialImport(options));
    return null;
  }

  act(() => root.render(React.createElement(Probe)));
  cleanups.push(() => act(() => root.unmount()));
  return {
    get current() {
      return capture.mock.lastCall?.[0] as ReturnType<
        typeof useCredentialImport
      >;
    },
  };
}
