// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import ImportCookiesModal from "./ImportCookiesModal";
import type { ImportCookiesController } from "./useImportCookiesController";

const state = vi.hoisted(() => ({ importing: true }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./useImportCookiesController", () => ({
  useImportCookiesController: () =>
    ({
      stage: "preview",
      sourcesLoading: false,
      sources: [],
      unavailableSource: null,
      activeSource: null,
      previewLoading: false,
      preview: null,
      selectedDomains: new Set<string>(),
      importing: state.importing,
      result: null,
      selectSource: vi.fn(),
      refreshSources: vi.fn(),
      openFullDiskAccessSettings: vi.fn(),
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
