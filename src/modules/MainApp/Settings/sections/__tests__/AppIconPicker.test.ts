// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppIconPicker } from "../AppIconPicker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AppIconPicker", () => {
  const mountedNodes: Array<{ node: HTMLDivElement; unmount: () => void }> = [];

  afterEach(async () => {
    for (const mounted of mountedNodes.splice(0)) {
      await act(async () => mounted.unmount());
      mounted.node.remove();
    }
  });

  it("renders app previews in a large segmented pill and changes selection", async () => {
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    mountedNodes.push({ node, unmount: () => root.unmount() });
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(AppIconPicker, {
          value: "dark",
          options: [
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "rainbow", label: "Rainbow" },
          ],
          onChange,
          ariaLabel: "App icon",
          dataTestId: "app-icon-picker",
        })
      );
    });

    const group = node.querySelector('[data-testid="app-icon-picker"]');
    expect(group?.className).toContain("h-8");
    expect(group?.getAttribute("aria-label")).toBe("App icon");
    expect(
      node
        .querySelector('button[aria-label="Dark"]')
        ?.getAttribute("aria-pressed")
    ).toBe("true");
    expect(node.querySelectorAll("img")).toHaveLength(3);

    await act(async () => {
      node
        .querySelector<HTMLButtonElement>('button[aria-label="Light"]')
        ?.click();
    });
    expect(onChange).toHaveBeenCalledWith("light");
  });
});
