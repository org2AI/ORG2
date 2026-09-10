// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { backgroundConfigPersistAtom } from "@src/store/ui/backgroundConfigAtom";

import { BackgroundSettings } from "./BackgroundSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/Message", () => ({ default: { warning: vi.fn() } }));
vi.mock("@src/modules/shared/layouts/SectionLayout", () => ({
  SECTION_CONTROL_STYLE: { width: 280 },
  SectionContainer: ({ children }: { children: ReactNode }) =>
    createElement("section", null, children),
  SectionRow: ({ label, children }: { label: string; children: ReactNode }) =>
    createElement("div", { "data-label": label }, children),
}));
vi.mock("@src/components/Slider", () => ({
  default: ({ onValueChange }: { onValueChange: (value: number) => void }) =>
    createElement("button", { onClick: () => onValueChange(75) }, "opacity"),
}));
vi.mock("./components/ColorSection", () => ({
  ColorSection: ({
    onAddCustomHex,
  }: {
    onAddCustomHex: (hex: string) => void;
  }) =>
    createElement(
      "button",
      { onClick: () => onAddCustomHex("#abc") },
      "palette"
    ),
}));

it("keeps embedded palette/opacity writes and undo/redo without a router", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createStore();
  const host = document.createElement("div");
  const root = createRoot(host);
  store.set(backgroundConfigPersistAtom, {
    customColors: [],
    pageOpacity: 100,
    sidebarOpacity: 100,
  });
  try {
    await act(async () =>
      root.render(
        createElement(Provider, { store }, createElement(BackgroundSettings))
      )
    );
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(store.get(backgroundConfigPersistAtom).backgroundColor).toBe(
      "#aabbcc"
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          '[data-label="background.pageOpacity"] button'
        )!
        .click()
    );
    expect(store.get(backgroundConfigPersistAtom).pageOpacity).toBe(75);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })
      )
    );
    expect(store.get(backgroundConfigPersistAtom).pageOpacity).toBe(100);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        })
      )
    );
    expect(store.get(backgroundConfigPersistAtom).pageOpacity).toBe(75);
    act(() => root.render(null));
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })
    );
    expect(store.get(backgroundConfigPersistAtom).pageOpacity).toBe(75);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
