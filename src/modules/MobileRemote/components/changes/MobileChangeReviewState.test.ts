// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileChangeReviewState } from "./MobileChangeReviewState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

it("replaces retry with a named static loading state without starting its own work", async () => {
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReviewState, { state: "error", onRetry })
    )
  );
  const button = host.querySelector("button")!;
  expect(host.textContent).toContain("changeReview.loadFailed");
  expect(button.style.height).toBe("var(--mobile-change-state-touch)");
  expect(button.querySelector("svg")).not.toBeNull();
  await act(async () => button.click());
  expect(onRetry).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReviewState, {
        state: "loading",
        onRetry,
      })
    )
  );
  expect(host.querySelector("button")).toBeNull();
  expect(host.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe(
    "true"
  );
  expect(host.textContent).toContain("changeReview.loading");
  expect(
    host.querySelector('.mobile-change-state__skeleton[aria-hidden="true"]')
      ?.children
  ).toHaveLength(3);
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it.each([
  ["offline", "changeReview.offline"],
  ["empty", "changeReview.empty"],
  ["unavailable", "changeReview.unavailable"],
] as const)(
  "keeps %s distinct and does not offer an invalid retry",
  async (state, message) => {
    const onRetry = vi.fn();
    await act(async () =>
      root.render(
        React.createElement(MobileChangeReviewState, {
          state,
          onRetry,
          compact: true,
        })
      )
    );
    expect(
      host.querySelector('[role="status"]')?.getAttribute("aria-busy")
    ).toBe("false");
    expect(host.textContent).toBe(message);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector(".mobile-change-state--compact")).not.toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  }
);

it("does not render a dead retry button without a request owner", async () => {
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReviewState, { state: "error" })
    )
  );
  expect(host.textContent).toBe("changeReview.loadFailed");
  expect(host.querySelector("button")).toBeNull();
});
