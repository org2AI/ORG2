// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spotlightCommandViewAtom } from "@src/store/ui/spotlightCommandViewAtom";

import type { UseSelectorReturn } from "../hooks/selectors/useSelector";
import { installVirtualListTestLayout } from "../palettes/BranchPalette/__tests__/virtualListTestLayout";
import type { SpotlightItem } from "../types";
import { groupSpotlightCards } from "./SpotlightCardList";
import { SpotlightCommandView } from "./SpotlightCommandView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../shell/ShellFooterAction", () => ({
  ShellFooterAction: ({ children }: { children: React.ReactNode }) => children,
}));

const item = (id: string, header = false): SpotlightItem => ({
  id,
  label: id,
  type: "action",
  data: header ? { isHeader: true } : undefined,
});

describe("Spotlight command presentation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let restoreLayout: () => void;
  let store: ReturnType<typeof createStore>;
  let kernel: UseSelectorReturn;
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const render = (items: SpotlightItem[]) =>
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(SpotlightCommandView, {
            kernel,
            items,
            placeholder: "Search",
            containerHeight: 400,
          })
        )
      )
    );
  const toggle = (label: string) =>
    act(() => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (node) => node.textContent === label
      )!;
      button.click();
    });

  beforeEach(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    restoreLayout = installVirtualListTestLayout();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    store = createStore();
    store.set(spotlightCommandViewAtom, "tui");
    kernel = {
      searchQuery: "",
      setSearchQuery: vi.fn(),
      setSearchQueryRaw: vi.fn(),
      selectedIndex: 1,
      setSelectedIndex: vi.fn(),
      inputRef: { current: null },
      handleKeyDown: vi.fn(),
      handleItemClick: vi.fn(),
      focusInput: vi.fn(),
      findFirstSelectable: () => 1,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreLayout();
    localStorage.removeItem("orgii-spotlight-command-view");
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps headers and odd sections separate without losing indices", () => {
    expect(
      groupSpotlightCards([
        item("recent", true),
        item("a"),
        item("b"),
        item("c"),
        item("commands", true),
        item("d"),
        item("e"),
      ])
    ).toEqual([[0], [1, 2, 3], [4], [5, 6]]);
  });

  it("switches formats without losing query, selection, focus, or activation", () => {
    const items = [
      item("recent", true),
      item("New session"),
      item("Create project"),
    ];
    kernel.searchQuery = "session";
    render(items);
    toggle("GUI");
    expect(store.get(spotlightCommandViewAtom)).toBe("gui");
    expect(localStorage.getItem("orgii-spotlight-command-view")).toBe('"gui"');
    expect(document.activeElement).toBe(kernel.inputRef.current);
    expect(kernel.inputRef.current?.value).toBe("session");
    const selected = container.querySelector<HTMLElement>(
      ".spotlight-item.selected"
    )!;
    expect(selected.dataset.spotlightItemIndex).toBe("1");
    expect(selected.style.height).toBe("80px");
    act(() => selected.click());
    expect(kernel.handleItemClick).toHaveBeenCalledWith(items[1]);
    act(() =>
      selected.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    );
    expect(kernel.handleItemClick).toHaveBeenCalledTimes(2);
    toggle("TUI");
    expect(container.querySelector('[data-spotlight-view="gui"]')).toBeNull();
    expect(
      container
        .querySelector(".spotlight-item.selected")
        ?.getAttribute("data-spotlight-item-index")
    ).toBe("1");
    expect(kernel.inputRef.current?.value).toBe("session");
  });

  it("bounds rendered cards and scrolls distant keyboard selections into view", async () => {
    const items = Array.from({ length: 1000 }, (_, index) =>
      item(`Action ${index}`)
    );
    render(items);
    toggle("GUI");
    expect(container.querySelectorAll(".spotlight-item").length).toBeLessThan(
      60
    );
    kernel.selectedIndex = 900;
    await act(async () => render(items));
    expect(
      container.querySelector('[data-spotlight-item-index="900"]')
    ).not.toBeNull();
    expect(container.querySelectorAll(".spotlight-item").length).toBeLessThan(
      60
    );
    await act(async () => {
      toggle("TUI");
    });
    await act(async () => {
      toggle("GUI");
    });
    expect(
      container.querySelector('[data-spotlight-item-index="900"]')
    ).not.toBeNull();
  });
});
