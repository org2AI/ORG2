// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ConnectionErrorScreen } from "./ConnectionErrorScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("offers separate retry and re-pair actions, disables both during recovery, and announces failure", () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const onRetry = vi.fn();
  const onRepair = vi.fn();
  try {
    act(() =>
      root.render(
        React.createElement(ConnectionErrorScreen, { onRetry, onRepair })
      )
    );
    const buttons = container.querySelectorAll("button");
    act(() => buttons[0].click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRepair).not.toHaveBeenCalled();
    act(() => buttons[1].click());
    expect(onRepair).toHaveBeenCalledOnce();
    act(() =>
      root.render(
        React.createElement(ConnectionErrorScreen, {
          onRetry,
          onRepair,
          busy: true,
          actionError: "retry",
        })
      )
    );
    expect(
      Array.from(container.querySelectorAll("button")).every(
        (button) => button.disabled
      )
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "connectionRecovery.retryFailed"
    );
  } finally {
    act(() => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
