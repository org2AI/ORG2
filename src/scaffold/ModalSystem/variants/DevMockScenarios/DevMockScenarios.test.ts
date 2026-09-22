// @vitest-environment jsdom
import { Provider } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeDevMockScenariosAtom,
  devMockScenariosAtom,
  devMockScenariosModalOpenAtom,
  resetDevMockScenariosForTest,
} from "@src/store/dev/mockScenarios";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import DevMockScenariosModal from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("DevMockScenariosModal", () => {
  let host: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;

  // Modal renders through a portal on document.body, not inside `host`.
  // Match on the test id: a footer button's text also carries its shortcut hint.
  const footerButton = (testId: string) =>
    document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    resetInstrumentedStore();
    store = createInstrumentedStore();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    store.set(devMockScenariosModalOpenAtom, true);
    act(() =>
      root.render(
        createElement(Provider, { store }, createElement(DevMockScenariosModal))
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetInstrumentedStore();
    resetDevMockScenariosForTest();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("renders the same switch set as Settings → Dev mode", () => {
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(5);
  });

  it("stays wide enough to keep a description on one line", () => {
    const content = document.querySelector<HTMLElement>(
      ".liquid-modal-content"
    );

    // Below SectionRow's @[480px] container query the switch stacks under
    // the text and every description wraps, so the dialog must stay wide.
    expect(content?.classList.contains("modal-large")).toBe(true);
    expect(content?.style.width).toBe("700px");
  });

  it("keeps the row density Settings uses", () => {
    // 12px descriptions, not SectionRow's 11px compact mode — the modal and
    // the Settings section render the same component at the same size.
    // Scoped to the rows: the footer's Esc pill is legitimately 11px.
    const descriptions = Array.from(
      document.querySelectorAll("[data-settings-search-description]")
    );

    expect(descriptions).toHaveLength(5);
    for (const description of descriptions) {
      expect(description.className).toContain("text-[12px]");
      expect(description.className).not.toContain("text-[11px]");
    }
  });

  it("turns every scenario off from the footer", () => {
    act(() => {
      store.set(devMockScenariosAtom, { id: "newUser", enabled: true });
      store.set(devMockScenariosAtom, { id: "noSessions", enabled: true });
    });

    const reset = footerButton("dev-mock-reset");
    expect(reset?.disabled).toBe(false);

    act(() => reset!.click());

    expect(store.get(activeDevMockScenariosAtom)).toEqual({
      newUser: false,
      noKeys: false,
      noWorkingDirectories: false,
      noSessions: false,
    });
    expect(footerButton("dev-mock-reset")?.disabled).toBe(true);
  });

  it("closes without undoing the scenarios that are on", () => {
    act(() => store.set(devMockScenariosAtom, { id: "noKeys", enabled: true }));

    act(() => footerButton("dev-mock-done")!.click());

    expect(store.get(devMockScenariosModalOpenAtom)).toBe(false);
    expect(store.get(activeDevMockScenariosAtom).noKeys).toBe(true);
  });
});
