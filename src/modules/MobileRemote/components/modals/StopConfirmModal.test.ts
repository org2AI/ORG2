// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StopConfirmModal } from "./StopConfirmModal";

vi.mock("@src/components/BottomSheet", () => ({
  default: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => (open ? React.createElement("section", null, children, footer) : null),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("StopConfirmModal failure feedback", () => {
  it("keeps a safe error and retry action visible after failure", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      React.createElement(StopConfirmModal, {
        visible: true,
        failed: true,
      })
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "stopConfirm.failed"
    );
    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent).filter(Boolean)).toEqual(
      ["stopConfirm.cancel", "stopConfirm.confirm"]
    );
    expect(
      host.querySelector('[role="alert"] button[aria-label="actions.copy"]')
    ).not.toBeNull();
    expect(host.querySelectorAll("button:disabled")).toHaveLength(0);
  });
  it("does not show an old error after dismissing the modal", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(StopConfirmModal, {
          visible: false,
          failed: true,
        })
      )
    ).toBe("");
  });
});
