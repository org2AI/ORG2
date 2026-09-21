// @vitest-environment jsdom
import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { expect, it } from "vitest";

import Input from "@src/components/Input";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { SpotlightFormField } from "./SpotlightFormField";

it("gives repeated fields unique associated labels and described errors", async () => {
  const root = createSmokeRoot();
  try {
    await root.render(
      createElement(
        "div",
        null,
        ...["Name", "Path"].map((label) =>
          jsx(SpotlightFormField, {
            key: label,
            label,
            required: true,
            help: "Required",
            error: true,
            children: createElement(Input, { value: "", onChange: () => {} }),
          })
        )
      )
    );
    const inputs = [...root.container.querySelectorAll("input")];
    expect(new Set(inputs.map((i) => i.id)).size).toBe(2);
    root.container
      .querySelectorAll("label")
      .forEach((label, i) => expect(label.control).toBe(inputs[i]));
    for (const input of inputs) {
      expect(input.required).toBe(true);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(
        document.getElementById(input.getAttribute("aria-describedby")!)
          ?.textContent
      ).toBe("Required");
    }
  } finally {
    await root.unmount();
  }
});
