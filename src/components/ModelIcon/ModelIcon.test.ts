// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import ModelIcon from ".";

function renderIcon(props: Record<string, unknown>): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(ModelIcon, props));
  });
  return host;
}

describe("ModelIcon fallbacks", () => {
  it("draws the routing-tier placeholder, not the agent's brand mark", () => {
    const host = renderIcon({ modelName: "default", agentType: "claude_code" });
    expect(host.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
      "clock-04"
    );
    expect(host.querySelector("img")).toBeNull();
  });

  it("keeps the Cursor mark for Cursor's own tiers", () => {
    const host = renderIcon({ modelName: "default", agentType: "cursor_cli" });
    expect(host.querySelector("[data-icon]")).toBeNull();
    // The brand glyph carries its own <title>, inlined either as a component
    // or (under vitest) as a data: URI.
    expect(host.innerHTML).toContain("Cursor");
  });

  it("keeps the generic box for a model name it does not recognize", () => {
    const host = renderIcon({ modelName: "some-unlisted-model" });
    expect(host.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
      "box"
    );
  });

  it("lets an explicit fallback win over both", () => {
    const host = renderIcon({
      modelName: "default",
      fallback: React.createElement("span", { "data-testid": "custom" }),
    });
    expect(host.querySelector("[data-testid='custom']")).not.toBeNull();
    expect(host.querySelector("[data-icon]")).toBeNull();
  });
});
