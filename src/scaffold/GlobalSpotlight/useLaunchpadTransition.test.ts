// @vitest-environment jsdom
import { Provider, createStore, useAtomValue } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spotlightOpenAtom } from "@src/store/ui/uiAtom";

import {
  animateLaunchpadTransition,
  launchpadTransitionSourceAtom,
  useLaunchpadTransition,
} from "./useLaunchpadTransition";

describe("Launchpad Spotlight animation lifecycle", () => {
  let source: HTMLElement;
  let panel: HTMLElement;
  const cancel = vi.fn();
  const animate = vi.fn();

  beforeEach(() => {
    source = document.createElement("button");
    panel = document.createElement("div");
    panel.innerHTML = "<div>Search results</div>";
    document.body.append(source, panel);
    source.getBoundingClientRect = () => new DOMRect(300, 20, 300, 28);
    panel.getBoundingClientRect = () => new DOMRect(200, 100, 500, 400);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    animate.mockImplementation(() => ({
      cancel,
      finished: new Promise<void>(() => undefined),
    }));
    vi.stubGlobal("HTMLElement", HTMLElement);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("cancels once and restores the live panel when hidden during opening", () => {
    const done = vi.fn();
    const stop = animateLaunchpadTransition(panel, source, done);
    expect(panel.style.opacity).toBe("0");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    stop();
    expect(cancel).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    expect(panel.style.opacity).toBe("");
    expect(document.body.children).toHaveLength(2);
  });

  it("closes immediately, cancels an unfinished opening, and can reopen", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(200, 100, 500, 400)
    );
    const store = createStore();
    store.set(launchpadTransitionSourceAtom, source);
    store.set(spotlightOpenAtom, true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      const open = useAtomValue(spotlightOpenAtom);
      const transitionRef = useLaunchpadTransition(open);
      return open
        ? createElement(
            "div",
            { ref: transitionRef, "data-live-search": true },
            "Search"
          )
        : null;
    }
    act(() =>
      root.render(createElement(Provider, { store }, createElement(Harness)))
    );
    act(() => store.set(spotlightOpenAtom, false));
    expect(host.querySelector("[data-live-search]")).toBeNull();
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    act(() => {
      store.set(launchpadTransitionSourceAtom, source);
      store.set(spotlightOpenAtom, true);
    });
    expect(host.querySelector("[data-live-search]")).not.toBeNull();
    expect(store.get(launchpadTransitionSourceAtom)).toBe(source);
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    act(() => root.unmount());
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(source.hasAttribute("data-spotlight-source-active")).toBe(false);
    expect(store.get(launchpadTransitionSourceAtom)).toBeNull();
  });

  it.each(["reduced motion", "hidden", "missing source"])(
    "skips animation for %s",
    (reason) => {
      if (reason === "reduced motion")
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
      if (reason === "hidden")
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      if (reason === "missing source") source.remove();
      const done = vi.fn();
      animateLaunchpadTransition(panel, source, done);
      expect(animate).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledOnce();
    }
  );
});
