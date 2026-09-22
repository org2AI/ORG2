// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SpotlightItem } from "../../../types";
import {
  MARKET_PURCHASE_HINT_TEST_ID,
  TwoColumnModelBody,
} from "../TwoColumnModelBody";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

const onOpenMarket = vi.fn();

const baseProps = {
  items: [] as SpotlightItem[],
  selectedIndex: -1,
  onItemSelect: vi.fn(),
  onItemHover: vi.fn(),
  searchQuery: "",
  activeColumn: "models" as const,
  sourceItems: [] as SpotlightItem[],
  selectedSourceIndex: -1,
  hasFocusedModel: false,
  accountsLoading: false,
  accountsError: null,
  onRetryAccounts: vi.fn(),
  onSourceSelect: vi.fn(),
  onSourceHover: vi.fn(),
};

let root: Root;
let container: HTMLDivElement;

function render(props: Record<string, unknown>) {
  act(() =>
    root.render(createElement(TwoColumnModelBody, { ...baseProps, ...props }))
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onOpenMarket.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("prompts the user to buy a package instead of reporting an empty list", () => {
  render({
    marketPurchaseHint: { host: "market.org2.dev", onOpenMarket },
  });

  const text = container.textContent ?? "";
  expect(text).toContain("selectors.modelSelector.marketEmpty.title");
  // The host comes from the Market console origin, so a dev override still
  // names the site the button opens.
  expect(text).toContain(
    "selectors.modelSelector.marketEmpty.subtitle:market.org2.dev"
  );
  expect(text).not.toContain("placeholders.noItemsAvailable");
  // Nothing to navigate on the left, so the right column drops its hint.
  expect(text).not.toContain("chooseModelHint");

  const button = container.querySelector<HTMLButtonElement>(
    `[data-testid="${MARKET_PURCHASE_HINT_TEST_ID}"]`
  );
  expect(button).not.toBeNull();
  act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(onOpenMarket).toHaveBeenCalledTimes(1);
});

it("keeps the ordinary empty state when the hint does not apply", () => {
  render({});

  const text = container.textContent ?? "";
  expect(text).toContain("placeholders.noItemsAvailable");
  expect(text).not.toContain("marketEmpty");
  expect(
    container.querySelector(`[data-testid="${MARKET_PURCHASE_HINT_TEST_ID}"]`)
  ).toBeNull();
});
