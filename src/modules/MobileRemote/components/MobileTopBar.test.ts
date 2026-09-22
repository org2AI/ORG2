// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileTopBar } from "./MobileTopBar";

describe("MobileTopBar", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const env = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previousAct: boolean | undefined;

  beforeEach(() => {
    previousAct = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    env.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });

  it("keeps the circular back control and title in their separate detail-header slots", () => {
    const onBack = vi.fn();
    act(() =>
      root.render(
        React.createElement(MobileTopBar, {
          title: "A session title that is longer than the narrow phone header",
          onBack,
          backAriaLabel: "Return to sessions",
          trailing: React.createElement("span", null, "Actions"),
        })
      )
    );
    const header = host.querySelector("header")!;
    const back = host.querySelector("button")!;
    const title = host.querySelector("h1")!;
    expect(header.classList.contains("mobile-top-bar--detail")).toBe(true);
    expect(Array.from(header.children)).toEqual([
      back,
      title,
      header.querySelector(".mobile-top-bar__trailing"),
    ]);
    expect(title.classList.contains("mobile-top-bar__title")).toBe(true);
    expect(title.textContent).toBe(
      "A session title that is longer than the narrow phone header"
    );
    // This asserts the DOM/style contract with the real shared Button;
    // pixel alignment and actual clipping still require a browser check.
    expect(back.classList.contains("button")).toBe(true);
    expect(back.type).toBe("button");
    expect(back.getAttribute("aria-label")).toBe("Return to sessions");
    expect(back.style.width).toBe("var(--mobile-touch-size)");
    expect(back.style.height).toBe("var(--mobile-touch-size)");
    expect(back.style.borderRadius).toBe("50%");
    expect(back.style.padding).toBe("0px");
    expect(back.querySelector(".truncate")).toBeNull();
    expect(back.querySelector("svg")).not.toBeNull();
    act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
