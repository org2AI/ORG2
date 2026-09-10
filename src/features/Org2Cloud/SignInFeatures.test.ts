// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInFeatures } from "./SignInFeatures";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let root: Root;
let container: HTMLDivElement;
let hidden = false;
let reduced = false;
let motion: EventTarget;

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  hidden = false;
  reduced = false;
  motion = new EventTarget();
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible"
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: motion.addEventListener.bind(motion),
    removeEventListener: motion.removeEventListener.bind(motion),
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => {
    root.unmount();
    vi.advanceTimersByTime(0);
  });
  expect(vi.getTimerCount()).toBe(0);
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});
const mount = () => act(() => root.render(React.createElement(SignInFeatures)));
const advance = () => act(() => vi.advanceTimersByTime(6000));
const title = () => container.querySelector("h3")!.textContent;

describe("login feature rotation", () => {
  it("cycles with one timer and stops while hidden or unmounted", () => {
    mount();
    expect(title()).toBe("cloud.share.dialogTitle");
    expect(vi.getTimerCount()).toBe(1);
    const firstImage = container.querySelector("img")!.src;
    advance();
    expect(title()).toBe("ORG2 Market");
    expect(container.querySelector("img")!.src).not.toBe(firstImage);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    advance();
    expect(title()).toBe("ORG2 Market");
    act(() => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    advance();
    expect(title()).toBe("mobileRemote:welcome.title");
    expect(container.querySelector("p")!.textContent).toBe(
      "cloud.featureMobileRemoteBody"
    );
    expect(container.querySelector("img")!.src).not.toBe(firstImage);
    expect(vi.getTimerCount()).toBe(1);
    advance();
    expect(title()).toBe("cloud.share.dialogTitle");
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    mount();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("supports previous and next with wrapping and keeps autoplay while hovered", () => {
    mount();
    const previous = container.querySelector<HTMLButtonElement>(
      '[aria-label="common:tooltips.previous"]'
    )!;
    const next = container.querySelector<HTMLButtonElement>(
      '[aria-label="common:tooltips.next"]'
    )!;
    act(() => previous.click());
    expect(title()).toBe("mobileRemote:welcome.title");
    act(() => next.click());
    expect(title()).toBe("cloud.share.dialogTitle");
    expect(vi.getTimerCount()).toBe(1);
    const section = container.querySelector("section")!;
    act(() =>
      section.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    );
    advance();
    expect(title()).toBe("ORG2 Market");
    expect(container.querySelector("p")!.textContent).toBe(
      "cloud.featureMarketBody"
    );
  });

  it("honors reduced motion on mount and when the preference changes", () => {
    reduced = true;
    mount();
    expect(vi.getTimerCount()).toBe(0);
    advance();
    expect(title()).toBe("cloud.share.dialogTitle");
    act(() => {
      reduced = false;
      motion.dispatchEvent(new Event("change"));
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      reduced = true;
      motion.dispatchEvent(new Event("change"));
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
