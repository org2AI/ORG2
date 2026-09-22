// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it, vi } from "vitest";

import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { SpotlightFormActions } from "./SpotlightFormActions";

it("preserves native form submission and disables both actions while busy", async () => {
  const submit = vi.fn(),
    back = vi.fn(),
    root = createSmokeRoot();
  const render = (busy: boolean) =>
    root.render(
      createElement(
        "form",
        {
          onSubmit: (e) => {
            e.preventDefault();
            submit();
          },
        },
        createElement(SpotlightFormActions, {
          backLabel: "Back",
          onBack: back,
          busy,
          submit: { label: "Save", htmlType: "submit" },
        })
      )
    );
  try {
    await render(false);
    await dispatch(() => root.container.querySelectorAll("button")[1].click());
    expect(submit).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
    await render(true);
    for (const button of root.container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
      await dispatch(() => button.click());
    }
    expect(submit).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  } finally {
    await root.unmount();
  }
});
