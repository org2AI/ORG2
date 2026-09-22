// @vitest-environment jsdom
import { act, createElement, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CURRENT_SHORTCUT_PLATFORM } from "@src/config/keyboard/shortcutBindings";

import { useChatSearchShortcut } from "../useChatSearchShortcut";

function Harness({ open }: { open: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const setSearchVisible = useCallback<typeof setVisible>(
    (update) => {
      open();
      setVisible(update);
    },
    [open]
  );
  useChatSearchShortcut(ref, setSearchVisible, visible);
  return createElement(
    "div",
    // createElement forwards the ref to React; it does not read ref.current.
    // eslint-disable-next-line react-hooks/refs
    { ref, "data-chat-view-root": true },
    createElement("textarea"),
    visible
      ? createElement(
          "div",
          { "data-chat-search-chrome": true, "data-find-card": true },
          createElement("input")
        )
      : null,
    createElement("div", { className: "cm-editor" }, createElement("input"))
  );
}

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const open = vi.fn();
  act(() => root.render(createElement(Harness, { open })));
  return { host, open };
}
function find(target: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    code: "KeyF",
    bubbles: true,
    cancelable: true,
    shiftKey,
    metaKey: CURRENT_SHORTCUT_PLATFORM === "mac",
    ctrlKey: CURRENT_SHORTCUT_PLATFORM !== "mac",
  });
  act(() => target.dispatchEvent(event));
  return event;
}

describe("useChatSearchShortcut", () => {
  it("toggles search from the composer, search input, and body after closing", () => {
    const { host, open } = mount();
    const composer = host.querySelector("textarea")!;
    composer.focus();
    expect(find(composer).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    const input = host.querySelector<HTMLInputElement>(
      "[data-chat-search-chrome] input"
    )!;
    expect(input).not.toBeNull();
    input.focus();
    expect(find(input).defaultPrevented).toBe(true);
    expect(host.querySelector("[data-chat-search-chrome]")).toBeNull();
    expect(find(document.body).defaultPrevented).toBe(true);
    expect(host.querySelector("[data-chat-search-chrome]")).not.toBeNull();
    expect(open).toHaveBeenCalledTimes(3);
  });
  it("toggles from search chrome portaled beside the transcript and rail", () => {
    const { host, open } = mount();
    host.dataset.chatPanel = "";
    const composer = host.querySelector("textarea")!;
    composer.focus();
    find(composer);
    const overlay = document.createElement("div");
    overlay.dataset.chatSearchChrome = "";
    overlay.dataset.findCard = "";
    const input = document.createElement("input");
    overlay.append(input);
    host.append(overlay);
    input.focus();
    expect(find(input).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    expect(
      host.querySelector("[data-chat-view-root] [data-chat-search-chrome]")
    ).toBeNull();
  });
  it("consumes key repeat without toggling again", () => {
    const { host, open } = mount();
    const composer = host.querySelector("textarea")!;
    composer.focus();
    find(composer);
    const event = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      bubbles: true,
      cancelable: true,
      repeat: true,
      metaKey: CURRENT_SHORTCUT_PLATFORM === "mac",
      ctrlKey: CURRENT_SHORTCUT_PLATFORM !== "mac",
    });
    act(() => composer.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-chat-search-chrome]")).not.toBeNull();
  });
  it("only opens the focused conversation and leaves other Find variants alone", () => {
    const first = mount();
    const second = mount();
    const composer = second.host.querySelector("textarea")!;
    composer.focus();
    expect(find(composer, true).defaultPrevented).toBe(false);
    find(composer);
    expect(first.open).not.toHaveBeenCalled();
    expect(second.open).toHaveBeenCalledOnce();
  });
  it("opens from an unregistered embedded editor and closes from outside the pane", () => {
    const { host, open } = mount();
    const editor = host.querySelector<HTMLElement>(".cm-editor input")!;
    editor.focus();
    expect(find(editor).defaultPrevented).toBe(true);
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(find(outside).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[data-find-card]")).toBeNull();
  });
  it("releases shortcut listeners on unmount", () => {
    const { host, open } = mount();
    host.querySelector("textarea")!.focus();
    act(() => roots.pop()!.unmount());
    expect(find(document.body).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
