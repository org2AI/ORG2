// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  PickerDropdownShell,
  getPickerDropdownBounds,
} from "./PickerDropdownShell";

it("fits wide anchored pickers inside a narrow viewport", () => {
  const bounds = getPickerDropdownBounds(
    { left: 250, top: 30, width: 100, maxHeight: 200 },
    420,
    320
  );
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.left + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.width).toBeLessThan(320);
});
it("preserves upward placement and the engine height budget in the portal", async () => {
  const root = createSmokeRoot();
  try {
    await root.render(
      createElement(
        PickerDropdownShell,
        {
          position: { left: 20, bottom: 40, width: 100, maxHeight: 120 },
          preferredWidth: 300,
          id: "picker-surface",
        },
        "Body"
      )
    );
    const panel = document.querySelector<HTMLElement>("#picker-surface")!;
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.bottom).toBe("40px");
    expect(panel.style.top).toBe("");
    expect(panel.style.maxHeight).toBe("120px");
    await root.unmount();
    expect(document.querySelector("#picker-surface")).toBeNull();
  } finally {
    await root.unmount();
  }
});
