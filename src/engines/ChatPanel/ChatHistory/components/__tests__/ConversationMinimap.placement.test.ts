// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ChatPanelFullScreenContext } from "../../../chatPanelFullScreenContext";
import ConversationMinimap from "../ConversationMinimap";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("moves the mounted navigator on enter/exit fullscreen without losing navigation or its focused preview", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const navigate = vi.fn();
  const props = {
    groupHeaders: [null, null],
    groupCounts: [1, 1],
    groupMeta: [],
    flatItems: [],
    activeGroupIndex: 0,
    visibleGroupIndices: [0],
    isAtBottom: false,
    isScrolling: true,
    onNavigate: navigate,
  };
  const render = async (fullScreen: boolean) =>
    act(async () =>
      root.render(
        React.createElement(
          ChatPanelFullScreenContext.Provider,
          { value: fullScreen },
          React.createElement(ConversationMinimap, props)
        )
      )
    );
  try {
    await render(false);
    const nav = host.querySelector("nav")!;
    const marker = nav.querySelector("button")!;
    expect(nav.className).toContain("right-3");
    await act(async () => marker.focus());
    expect(host.querySelector('[role="tooltip"]')?.className).toContain(
      "right-full"
    );
    await render(true);
    expect(host.querySelector("nav")).toBe(nav);
    expect(document.activeElement).toBe(marker);
    expect(nav.className).toContain("left-3");
    expect(nav.className).not.toContain("right-3");
    expect(host.querySelector('[role="tooltip"]')?.className).toContain(
      "left-full"
    );
    await act(async () => marker.click());
    expect(navigate).toHaveBeenCalledWith(0);
    await render(false);
    expect(nav.className).toContain("right-3");
    expect(host.querySelector('[role="tooltip"]')?.className).toContain(
      "right-full"
    );
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
