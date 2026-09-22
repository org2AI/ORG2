// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissHoverCard } from "@src/components/HoverCard/singletonStore";

import type { SpotlightItem } from "../../../types";
import { TwoColumnModelBody } from "../TwoColumnModelBody";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const rows: SpotlightItem[] = [
  {
    id: "recent-model",
    label: "OpenAI GPT 6 Astra High",
    type: "action",
    data: {
      modelSection: "recent",
      isCurrentSelection: true,
      description: "gpt-6-astra-high",
    },
  },
  {
    id: "model",
    label: "GPT 6 Astra",
    type: "action",
    data: { modelSection: "all", isCurrent: true, description: "gpt-6-astra" },
  },
];

const sources: SpotlightItem[] = [
  {
    id: "key",
    label: "OpenAI",
    type: "action",
    data: { isCurrentSelection: true, description: "Work key" },
  },
];

describe("TwoColumnModelBody", () => {
  let root: Root;
  let container: HTMLDivElement;
  const hover = (id: string) => {
    act(() => {
      container
        .querySelector(`[data-spotlight-item-id='${id}']`)!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    container.setAttribute("data-spotlight-detail-anchor", "");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(TwoColumnModelBody, {
          items: rows,
          selectedIndex: 0,
          onItemSelect: vi.fn(),
          onItemHover: vi.fn(),
          searchQuery: "",
          activeColumn: "models",
          sourceItems: sources,
          selectedSourceIndex: -1,
          hasFocusedModel: true,
          accountsLoading: false,
          accountsError: null,
          onRetryAccounts: vi.fn(),
          onSourceSelect: vi.fn(),
          onSourceHover: vi.fn(),
        })
      )
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      dismissHoverCard();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["recent-model", "model", "key"])(
    "does not open a hover detail card for the %s row",
    (id) => {
      hover(id);
      expect(document.querySelector("[data-spotlight-detail-pane]")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("renders Pinned above Recent, each under its own header", () => {
    const header = (section: string): SpotlightItem => ({
      id: `model-section:${section}`,
      label: `${section}-label`,
      type: "option",
      data: { isHeader: true },
    });
    act(() =>
      root.render(
        createElement(TwoColumnModelBody, {
          items: [
            header("pinned"),
            {
              id: "pinned-model",
              label: "Pinned model",
              type: "action",
              data: { modelSection: "pinned" },
            },
            header("recent"),
            ...rows,
          ],
          selectedIndex: 1,
          onItemSelect: vi.fn(),
          onItemHover: vi.fn(),
          searchQuery: "",
          activeColumn: "models",
          sourceItems: sources,
          selectedSourceIndex: -1,
          hasFocusedModel: true,
          accountsLoading: false,
          accountsError: null,
          onRetryAccounts: vi.fn(),
          onSourceSelect: vi.fn(),
          onSourceHover: vi.fn(),
        })
      )
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("pinned-label")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("pinned-label")).toBeLessThan(
      text.indexOf("recent-label")
    );
    const ids = Array.from(
      container.querySelectorAll("[data-spotlight-item-id]"),
      (node) => node.getAttribute("data-spotlight-item-id")
    );
    expect(ids.slice(0, 3)).toEqual(["pinned-model", "recent-model", "model"]);
  });
});
