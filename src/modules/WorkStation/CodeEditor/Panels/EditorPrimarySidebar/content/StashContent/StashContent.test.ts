// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { HEADER_CLASSES } from "@src/config/workstation/tokens";

import StashContent from ".";
import { StashHeaderContext } from "./StashHeaderContext";

const mocks = vi.hoisted(() => ({ language: "en" }));
vi.mock("@src/hooks/tabHost/useWorkStationTabs", () => ({
  useWorkStationTabs: () => ({ openTab: vi.fn(), activeTab: null }),
}));
vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const { default: en } = await import("@src/i18n/locales/en/common.json");
  const { default: zh } = await import("@src/i18n/locales/zh/common.json");
  const instance = createInstance();
  await instance.init({
    lng: "en",
    defaultNS: "common",
    resources: { en: { common: en }, zh: { common: zh } },
  });
  return { useTranslation: () => ({ t: instance.getFixedT(mocks.language) }) };
});

it.each(["en", "zh"])(
  "uses one 32px navigation/action row in %s, including zero stashes",
  (language) => {
    mocks.language = language;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onBack = vi.fn();
    const action = vi.fn();
    try {
      for (const count of [0, 63]) {
        act(() =>
          root.render(
            createElement(
              StashHeaderContext.Provider,
              {
                value: {
                  onBack,
                  actions: [
                    {
                      key: "filter",
                      icon: "filter",
                      tooltip: "filter",
                      onClick: action,
                      forceVisible: true,
                    },
                  ],
                },
              },
              createElement(StashContent, {
                stashes: Array.from({ length: count }, (_, index) => ({
                  index,
                  message: `Saved ${index}`,
                  commit_sha: `sha-${index}`,
                  branch: "main",
                })),
                operationLoading: true,
                onStashApply: vi.fn(),
                onStashPop: vi.fn(),
                onStashDrop: vi.fn(),
              })
            )
          )
        );
        const headers = Array.from(container.querySelectorAll("div")).filter(
          (node) =>
            HEADER_CLASSES.sectionHeader
              .split(" ")
              .every((token) => node.classList.contains(token))
        );
        expect(headers).toHaveLength(1);
        const header = headers[0];
        expect(header.classList.contains("h-8")).toBe(true);
        expect(header.textContent).toContain(
          language === "zh" ? `${count}个STASHES` : `${count} stashes`
        );
        expect(header.querySelector('[data-icon="chevron-down"]')).toBeNull();
        const pop = header.querySelector<HTMLButtonElement>("button[disabled]");
        expect(pop?.disabled).toBe(true);
        const back = header.querySelector<HTMLButtonElement>("button");
        act(() => back!.click());
        const filter =
          header.querySelector<HTMLButtonElement>('[title="filter"]');
        expect(filter).not.toBeNull();
        // Disabled actions keep shared dimensions and hover treatment, but
        // intentionally have a different cursor and opacity.
        expect(pop!.style.height).toBe(filter!.style.height);
        expect(pop!.style.width).toBe(filter!.style.width);
        const hoverClasses = (button: HTMLButtonElement) =>
          [...button.classList].filter((token) => token.includes("hover:"));
        expect(hoverClasses(pop!)).toEqual(hoverClasses(filter!));
        expect(filter!.disabled).toBe(false);
        expect(pop!.parentElement!.parentElement).toBe(
          filter!.parentElement!.parentElement
        );
        expect(
          pop!.compareDocumentPosition(filter!) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        act(() => filter!.click());
      }
      expect(onBack).toHaveBeenCalledTimes(2);
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  }
);
