// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { SpotlightFormLayout } from "./SpotlightFormLayout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("shares a keyboard-accessible path header without adding a search field or intercepting trailing actions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onBack = vi.fn();
  const onRefresh = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(
          SpotlightFormLayout,
          {
            header: {
              path: [
                {
                  id: "workspace",
                  type: "action",
                  label: "Add workspace",
                  icon: "",
                  color: "primary",
                },
                {
                  id: "clone",
                  type: "action",
                  label: "Clone repository",
                  icon: "",
                  color: "primary",
                },
              ],
              onRemoveSegment: onBack,
              trailingSlot: createElement(
                "button",
                { onClick: onRefresh },
                "Refresh"
              ),
            },
          },
          createElement("textarea", { "aria-label": "Form field" })
        )
      )
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).not.toBeNull();
    const back = container.querySelector<HTMLButtonElement>(
      'button[title="Clone repository"]'
    )!;
    expect(back.type).toBe("button");
    expect(back.tabIndex).toBe(0);
    act(() => back.click());
    expect(onBack).toHaveBeenCalledWith(1);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Refresh")!
        .click()
    );
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
