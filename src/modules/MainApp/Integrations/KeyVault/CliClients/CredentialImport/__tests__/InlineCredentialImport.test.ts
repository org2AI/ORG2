// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InlineCredentialImport from "../InlineCredentialImport";

const state = vi.hoisted(() => ({
  importError: "",
  importErrors: [] as Array<{
    id: string;
    displayName: string;
    sourceLabel: string;
    error: string;
  }>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { message?: string }) =>
      values?.message ? `${key}: ${values.message}` : key,
  }),
}));
vi.mock("../useCredentialImport", () => ({
  useCredentialImport: () => ({
    ...state,
    items: [],
    allImportableItems: [],
    importableItems: [],
    selected: new Set(),
    importLoading: false,
    importing: false,
    importColumns: [],
    handleImport: vi.fn(),
  }),
}));
vi.mock("@src/components/SettingsTable", () => ({ default: () => null }));

beforeEach(() => {
  state.importError = "";
  state.importErrors = [];
});

describe("InlineCredentialImport notices", () => {
  it("keeps both whole-import and per-credential failures readable in live notices", () => {
    state.importError = "Keychain unavailable";
    state.importErrors = [
      {
        id: "claude",
        displayName: "Claude Code",
        sourceLabel: "Claude Code-credentials",
        error: "Token expired. Sign in again.",
      },
      {
        id: "kiro",
        displayName: "Kiro CLI",
        sourceLabel: "kiro/credentials",
        error: "Permission denied",
      },
    ];
    const markup = renderExpandedImport();
    expect(markup.match(/role="alert"/g)).toHaveLength(2);
    expect(markup).toContain("Keychain unavailable");
    expect(markup).toContain("credentialImport.partialFailure");
    for (const failure of state.importErrors) {
      expect(markup).toContain(failure.displayName);
      expect(markup).toContain(failure.sourceLabel);
      expect(markup).toContain(failure.error);
    }
    expect(markup.match(/<li>/g)).toHaveLength(2);
    expect(markup).not.toContain("bg-warning-1");
    expect(markup).not.toContain("bg-danger-1");
  });

  it("does not announce an error before an import fails", () => {
    const markup = renderExpandedImport();
    expect(markup).not.toContain('role="alert"');
  });
});

function renderExpandedImport() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(InlineCredentialImport)));
    const toggle = container.querySelector("button");
    expect(toggle).not.toBeNull();
    act(() => toggle!.click());
    const markup = container.innerHTML;
    act(() => toggle!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    return markup;
  } finally {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
}
