// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REFRESH_ICON_TOKENS } from "@src/components/RefreshIcon/tokens";

import { PrChecksRefreshButton } from "./PrChecksRefreshButton";
import {
  PrChecksRefreshContext,
  type PrChecksRefreshValue,
} from "./prChecksRefreshContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("PrChecksRefreshButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(value: PrChecksRefreshValue | null, onRowClick = vi.fn()) {
    act(() => {
      root.render(
        createElement(
          PrChecksRefreshContext.Provider,
          { value },
          createElement(
            "div",
            { onClick: onRowClick },
            createElement(PrChecksRefreshButton)
          )
        )
      );
    });
    return container.querySelector<HTMLButtonElement>(
      '[data-testid="pr-checks-refresh"]'
    );
  }

  it("renders nothing outside a mounted pull request", () => {
    expect(render(null)).toBeNull();
  });

  it("re-polls on click without toggling the row it sits in, spinning on the refresh token", async () => {
    const refreshChecks = vi.fn(() => Promise.resolve());
    const onRowClick = vi.fn();
    const button = render({ refreshChecks, refreshing: false }, onRowClick);
    expect(button?.getAttribute("aria-label")).toBe("Refresh checks");

    // `useRefreshSpin` restarts the CSS animation first and refreshes on the
    // next frame.
    await act(async () => {
      button?.click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
    });

    expect(refreshChecks).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-icon="refresh-cw"]')?.getAttribute("class")
    ).toContain(REFRESH_ICON_TOKENS.oneShot);
  });

  it("spins continuously and refuses clicks while a poll is in flight", () => {
    const refreshChecks = vi.fn(() => Promise.resolve());
    const button = render({ refreshChecks, refreshing: true });

    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-label")).toBe("Refreshing…");
    expect(
      container.querySelector('[data-icon="refresh-cw"]')?.getAttribute("class")
    ).toContain(REFRESH_ICON_TOKENS.spin);
    act(() => button?.click());
    expect(refreshChecks).not.toHaveBeenCalled();
  });
});
