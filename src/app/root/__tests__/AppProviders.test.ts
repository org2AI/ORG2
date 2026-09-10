// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--orgii-chat-width");
});

it("initializes chat width from the provider store before rendering children", async () => {
  vi.resetModules();
  localStorage.setItem("globalChatWidth", "0");
  document.documentElement.style.removeProperty("--orgii-chat-width");
  const { AppProviders } = await import("../AppProviders");
  const { getInstrumentedStore } =
    await import("@src/util/core/state/instrumentedStore");
  const { chatWidthAtom } = await import("@src/store/ui/chatPanel/widthAtoms");
  function Child() {
    expect(
      document.documentElement.style.getPropertyValue("--orgii-chat-width")
    ).toBe("0px");
    expect(getInstrumentedStore().get(chatWidthAtom)).toBe(0);
    return createElement("span", null, "ready");
  }
  expect(
    renderToString(createElement(AppProviders, null, createElement(Child)))
  ).toContain("ready");
});
