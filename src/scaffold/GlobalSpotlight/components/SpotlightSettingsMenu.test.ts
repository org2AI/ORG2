// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type SpotlightPinScope,
  spotlightAgentPinsAtom,
  spotlightCommandPinsAtom,
  spotlightDirectoryPinsAtom,
  spotlightModelPinsAtom,
  spotlightPinAtoms,
} from "@src/store/ui/spotlightPinsAtom";

import { SpotlightSettingsMenu } from "./SpotlightSettingsMenu";

const mocks = vi.hoisted(() => ({ setSetting: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/hooks/settings/useSettings", () => ({
  useSetting: (key: string) => [
    true,
    (value: unknown) => mocks.setSetting(key, value),
  ],
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("SpotlightSettingsMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  const render = (pinScope: SpotlightPinScope | null = "commands") =>
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(SpotlightSettingsMenu, {
            pinScope: pinScope ?? undefined,
          })
        )
      );
    });
  const unpinAllItem = () =>
    Array.from(
      menu()!.querySelectorAll<HTMLButtonElement>("button, [role=menuitem]")
    ).find((node) =>
      node.textContent?.includes("selectors.spotlightFooter.unpinAll")
    );
  const menu = () =>
    document.querySelector<HTMLElement>(
      '[data-testid="spotlight-settings-menu"]'
    );
  const openMenu = () =>
    act(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="spotlight-settings-button"]'
        )!
        .click();
    });

  beforeEach(() => {
    localStorage.clear();
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mocks.setSetting.mockReset();
  });

  it("opens the menu with placement, dim, detail card and unpin controls", () => {
    render();
    expect(menu()).toBeNull();
    openMenu();
    const text = menu()?.textContent ?? "";
    expect(text).toContain("general.spotlightPlacement");
    expect(text).toContain("general.spotlightDimBackground");
    expect(text).toContain("general.spotlightDetailCard");
    expect(text).toContain("selectors.spotlightFooter.unpinAll");
  });

  it("writes the hover-card switch to its own setting key", () => {
    render();
    openMenu();
    const toggle = menu()!.querySelector<HTMLElement>(
      '[aria-label="general.spotlightDetailCard"]'
    )!;
    act(() => toggle.click());
    expect(mocks.setSetting).toHaveBeenCalledExactlyOnceWith(
      "general.spotlightDetailCard",
      false
    );
  });

  const seedAllPins = () => {
    store.set(spotlightCommandPinsAtom, ["cmd-a", "cmd-b"]);
    store.set(spotlightDirectoryPinsAtom, ["/repo"]);
    store.set(spotlightAgentPinsAtom, ["cli:codex"]);
    store.set(spotlightModelPinsAtom, [
      {
        modelId: "gpt-6-astra-low",
        sourceType: "own_key",
        accountId: "key",
        modelType: "codex",
      },
    ]);
  };

  const pinCounts = () =>
    Object.fromEntries(
      Object.entries(spotlightPinAtoms).map(([scope, atom]) => [
        scope,
        store.get(atom as typeof spotlightCommandPinsAtom).length,
      ])
    );

  it.each(Object.keys(spotlightPinAtoms) as SpotlightPinScope[])(
    "unpin all clears only the %s pins",
    (scope) => {
      seedAllPins();
      const before = pinCounts();
      render(scope);
      openMenu();
      act(() => unpinAllItem()!.click());
      expect(pinCounts()).toEqual({ ...before, [scope]: 0 });
      expect(menu()).toBeNull();
    }
  );

  it("hides unpin all on a surface without pins", () => {
    seedAllPins();
    render(null);
    openMenu();
    expect(unpinAllItem()).toBeUndefined();
  });

  it("disables unpin all when only another surface has pins", () => {
    store.set(spotlightDirectoryPinsAtom, ["/repo"]);
    render("commands");
    openMenu();
    const unpin = unpinAllItem()!;
    expect(
      unpin.hasAttribute("disabled") ||
        unpin.getAttribute("aria-disabled") === "true"
    ).toBe(true);
  });

  it("Escape closes only the menu, not Spotlight", () => {
    // Stands in for SpotlightShellChrome's bubble-phase Escape handler.
    const spotlightEscape = vi.fn();
    document.addEventListener("keydown", spotlightEscape);
    try {
      render();
      openMenu();
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      expect(menu()).toBeNull();
      expect(spotlightEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", spotlightEscape);
    }
  });
});
