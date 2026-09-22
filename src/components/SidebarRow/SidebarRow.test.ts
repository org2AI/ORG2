// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { SidebarRow } from ".";

it("preserves row activation, disabled state, selection, details and forwarded refs", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const ref = createRef<HTMLButtonElement>();
  const open = vi.fn();
  try {
    await act(async () =>
      root.render(
        React.createElement(SidebarRow, {
          label: "Commit title",
          metadata: "1m · Author · abc123",
          selected: true,
          onClick: open,
          ref,
        })
      )
    );
    expect(ref.current).toBe(host.querySelector("button"));
    expect(ref.current!.getAttribute("aria-pressed")).toBe("true");
    expect(ref.current!.type).toBe("button");
    await act(async () => ref.current!.click());
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(
        React.createElement(
          SidebarRow,
          {
            label: "Agent title",
            metadata: "1m · Read 2",
            disabled: true,
            indented: true,
            icon: React.createElement("svg", { "data-testid": "agent-icon" }),
            onClick: open,
            ref,
            title: "Agent attribution",
          },
          React.createElement(
            "span",
            { "data-testid": "attribution" },
            "Subagent · exact"
          )
        )
      )
    );
    expect(ref.current!.disabled).toBe(true);
    expect(ref.current!.getAttribute("aria-pressed")).toBeNull();
    expect(ref.current!.title).toBe("Agent attribution");
    expect(host.querySelector('[data-testid="agent-icon"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="attribution"]')!.textContent).toBe(
      "Subagent · exact"
    );
    await act(async () => ref.current!.click());
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
