// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  availableAppUpdateAtom,
  mockAppUpdateEnabledAtom,
} from "@src/scaffold/AppUpdater/state";
import { resetDevMockScenariosForTest } from "@src/store/dev/mockScenarios";

import DevelopmentSection from "../DevelopmentSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/layout/Section", () => ({
  SectionContainer: ({ children }: { children: ReactNode }) => children,
  SectionRow: ({ children }: { children: ReactNode }) => children,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  resetDevMockScenariosForTest();
  vi.unstubAllEnvs();
});

describe("DevelopmentSection", () => {
  it("opens all ten light/dark pairs and releases them when returning to controls", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const node = document.createElement("div");
    const root = createRoot(node);
    const store = createStore();
    const appTheme = document.documentElement.getAttribute("data-theme");
    try {
      await act(async () =>
        root.render(
          createElement(Provider, { store }, createElement(DevelopmentSection))
        )
      );
      expect(node.querySelectorAll("img")).toHaveLength(0);
      const selectTab = async (activeTab: string) => {
        await act(async () =>
          root.render(
            createElement(
              Provider,
              { store },
              createElement(DevelopmentSection, { activeTab })
            )
          )
        );
      };
      expect(node.querySelector("[data-tab-key]")).toBeNull();
      await selectTab("illustrations");
      const images = Array.from(node.querySelectorAll("img"));
      expect(images).toHaveLength(20);
      expect(new Set(images.map((image) => image.src)).size).toBe(10);
      for (const figure of node.querySelectorAll("figure")) {
        const image = figure.querySelector("img")!;
        expect(image.dataset.illustrationTheme).toBe(
          figure.dataset.previewTheme
        );
        expect(image.alt).toBe("");
        expect(image.getAttribute("loading")).toBe("lazy");
      }
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        appTheme
      );
      expect(store.get(mockAppUpdateEnabledAtom)).toBe(false);
      await selectTab("controls");
      expect(node.querySelectorAll("img")).toHaveLength(0);
      expect(node.querySelector('[role="switch"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("toggles shared availability and keeps the switch on after leaving settings", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();
    const node = document.createElement("div");
    const root = createRoot(node);
    const render = () =>
      root.render(
        createElement(Provider, { store }, createElement(DevelopmentSection))
      );
    try {
      await act(async () => render());
      expect(
        node.querySelector('[role="switch"]')?.getAttribute("aria-checked")
      ).toBe("false");
      await act(async () =>
        node.querySelector<HTMLButtonElement>('[role="switch"]')!.click()
      );
      expect(store.get(availableAppUpdateAtom)?.version).toBe("99.0.0");
      await act(async () => root.render(null));
      expect(store.get(mockAppUpdateEnabledAtom)).toBe(true);
      await act(async () => render());
      expect(
        node.querySelector('[role="switch"]')?.getAttribute("aria-checked")
      ).toBe("true");
      await act(async () =>
        node.querySelector<HTMLButtonElement>('[role="switch"]')!.click()
      );
      expect(store.get(availableAppUpdateAtom)).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("renders nothing when directly mounted in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      await act(async () => root.render(createElement(DevelopmentSection)));
      expect(node.innerHTML).toBe("");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
