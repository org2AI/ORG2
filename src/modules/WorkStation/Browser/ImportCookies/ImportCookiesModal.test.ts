// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { CookieImportSource } from "@src/api/tauri/browserCookies";

import ImportCookiesModal from "./ImportCookiesModal";
import type {
  ImportCookiesController,
  ImportStage,
} from "./useImportCookiesController";

const state = vi.hoisted(() => ({
  importing: true,
  stage: "preview" as ImportStage,
  sources: [] as CookieImportSource[],
  selectSource: vi.fn(),
  refreshSources: vi.fn(),
  openFullDiskAccessSettings: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./useImportCookiesController", () => ({
  useImportCookiesController: () =>
    ({
      stage: state.stage,
      sourcesLoading: false,
      sources: state.sources,
      activeSource: null,
      previewLoading: false,
      preview: null,
      selectedDomains: new Set<string>(),
      importing: state.importing,
      result: null,
      selectSource: state.selectSource,
      refreshSources: state.refreshSources,
      openFullDiskAccessSettings: state.openFullDiskAccessSettings,
      toggleDomain: vi.fn(),
      setAllDomains: vi.fn(),
      runImport: vi.fn(),
      backToSources: vi.fn(),
    }) satisfies ImportCookiesController,
}));
afterEach(() => vi.unstubAllGlobals());
it("prevents dismissal during import and restores closure after the request settles", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const render = () =>
    act(() => root.render(createElement(ImportCookiesModal, { onClose })));
  try {
    render();
    expect(document.querySelector('button[title="Close"]')).toBeNull();
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent === "actions.cancel")!;
    expect(cancel.disabled).toBe(true);
    act(() => {
      cancel.click();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      document.querySelector<HTMLElement>(".liquid-modal-mask")!.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    state.importing = false;
    render();
    act(() =>
      document
        .querySelector<HTMLButtonElement>('button[title="Close"]')!
        .click()
    );
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("offers the way out once, in the footer, however many sources are blocked", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.importing = false;
  state.stage = "sources";
  const blocked = (id: string, kind: CookieImportSource["kind"]) =>
    ({
      id,
      kind,
      browserId: id,
      browserLabel: id,
      profileLabel: null,
      unavailableReason: "needs_full_disk_access",
    }) satisfies CookieImportSource;
  const chrome: CookieImportSource = {
    id: "chrome:Default",
    kind: "chromium",
    browserId: "chrome",
    browserLabel: "Chrome",
    profileLabel: "Default",
    unavailableReason: null,
  };
  state.sources = [
    blocked("safari", "safari"),
    blocked("firefox", "firefox"),
    chrome,
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    act(() =>
      root.render(createElement(ImportCookiesModal, { onClose: vi.fn() }))
    );
  const byTestId = (id: string) =>
    document.querySelectorAll<HTMLButtonElement>(`[data-testid="${id}"]`);
  try {
    render();

    // Blocked rows only name the problem: not buttons, and holding none.
    const blockedRows = byTestId("cookie-source-blocked");
    expect(blockedRows).toHaveLength(2);
    for (const row of blockedRows) {
      expect(row.tagName).toBe("DIV");
      expect(row.querySelector("button")).toBeNull();
      expect(row.textContent).toContain(
        "browserCookieImport.safari.needsFullDiskAccess"
      );
    }

    // Full Disk Access is one switch, so its actions appear exactly once.
    expect(byTestId("cookie-sources-open-settings")).toHaveLength(1);
    expect(byTestId("cookie-sources-check-again")).toHaveLength(1);
    act(() => byTestId("cookie-sources-open-settings")[0].click());
    expect(state.openFullDiskAccessSettings).toHaveBeenCalledOnce();
    act(() => byTestId("cookie-sources-check-again")[0].click());
    expect(state.refreshSources).toHaveBeenCalledOnce();
    expect(state.selectSource).not.toHaveBeenCalled();

    // A readable source is still one click to its preview.
    const chromeRow = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Chrome"))!;
    act(() => chromeRow.click());
    expect(state.selectSource).toHaveBeenCalledWith("chrome:Default");

    // Nothing blocked: the picker goes back to having no footer at all.
    state.sources = [chrome];
    render();
    expect(byTestId("cookie-sources-open-settings")).toHaveLength(0);
    expect(byTestId("cookie-sources-check-again")).toHaveLength(0);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
