/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { SettingsTableSearchInput } from "./SettingsTableSearchInput";

const roots: Array<ReturnType<typeof createSmokeRoot>> = [];

async function mount(
  props: Partial<React.ComponentProps<typeof SettingsTableSearchInput>> = {}
): Promise<HTMLElement> {
  const root = createSmokeRoot();
  roots.push(root);
  await root.render(
    React.createElement(SettingsTableSearchInput, {
      value: "",
      placeholder: "Search models...",
      onChange: vi.fn(),
      ...props,
    })
  );
  // jsdom gives every element a zero-size box, so the shortcut registry would
  // never consider the field painted; report it the way a real layout would.
  const input = root.container.querySelector("input");
  if (input) {
    input.getClientRects = (() => [
      { width: 100, height: 20 },
    ]) as unknown as HTMLInputElement["getClientRects"];
  }
  return root.container;
}

function hint(container: HTMLElement): HTMLElement | null {
  return container.querySelector("kbd");
}

afterEach(async () => {
  while (roots.length > 0) await roots.pop()?.unmount();
});

describe("SettingsTableSearchInput", () => {
  it("shows the key hint by default — every settings table answers the chord", async () => {
    expect(hint(await mount())?.textContent).toContain("F");
  });

  it("opts a table out entirely on request", async () => {
    const container = await mount({ shortcut: false });
    expect(hint(container)).toBeNull();

    container.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        ctrlKey: true,
        bubbles: true,
      })
    );
    expect(document.activeElement).not.toBe(container.querySelector("input"));
  });

  it("gets the hint out of the way once the field is in use", async () => {
    // Typed-in value: the clear button owns that end of the field.
    expect(hint(await mount({ value: "gpt" }))).toBeNull();

    const container = await mount();
    const input = container.querySelector("input")!;
    input.focus();
    input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    await Promise.resolve();
    expect(hint(container)).toBeNull();
  });

  it("keeps the binding but drops the hint on request", async () => {
    const container = await mount({ shortcut: { hideHint: true } });
    expect(hint(container)).toBeNull();

    container.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        ctrlKey: true,
        bubbles: true,
      })
    );
    expect(document.activeElement).toBe(container.querySelector("input"));
  });
});
