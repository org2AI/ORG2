// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it, vi } from "vitest";

import Button from "@src/components/Button";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import { PickerOptionRow } from "./PickerOptionRow";

it("keeps variant editing separate from row selection and preserves disabled activation", async () => {
  const select = vi.fn(),
    edit = vi.fn(),
    hover = vi.fn();
  const root = createSmokeRoot();
  const render = (disabled = false) =>
    root.render(
      createElement(PickerOptionRow, {
        label: "Model",
        selected: true,
        disabled,
        testId: "model-row",
        keyboardProps: {
          "data-dropdown-item-index": 0,
          "data-dropdown-keyboard-highlight": "true",
          "aria-selected": true,
          onMouseEnter: hover,
          onClick: select,
        },
        trailing: createElement(Button, { onClick: edit }, "Edit variant"),
      })
    );
  try {
    await render();
    expect(root.container.querySelector("button button")).toBeNull();
    const [main, variant] = root.container.querySelectorAll("button");
    await dispatch(() => variant.click());
    expect(edit).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    await dispatch(() => main.click());
    expect(select).toHaveBeenCalledOnce();
    expect(main.textContent).toContain("Model");
    expect(root.container.querySelector('[data-icon="check"]')).not.toBeNull();
    await render(true);
    await dispatch(() =>
      root.container
        .querySelector<HTMLButtonElement>('[data-testid="model-row"]')!
        .click()
    );
    expect(select).toHaveBeenCalledOnce();
  } finally {
    await root.unmount();
  }
});
