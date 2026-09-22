// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HoverCard from ".";
import { dismissHoverCard } from "./singletonStore";

describe("shared content hover card", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Content({ label }: { label: string }) {
    useEffect(() => {
      mounted(label);
      return () => unmounted(label);
    }, [label]);
    return createElement("p", null, label);
  }
  const card = (id: string | null, label: string) =>
    jsx(HoverCard, {
      cardId: id,
      mouseEnterDelay: 50,
      content: createElement(Content, { label }),
      children: createElement("button", { "data-card": label }, label),
    });
  const hover = (label: string) => {
    act(() => {
      container
        .querySelector(`[data-card="${label}"]`)!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(50);
    });
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    dismissHoverCard();
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("mounts only the active content and replaces it across card types", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          card("pr:1", "PR"),
          card("commit:a", "Commit")
        )
      )
    );
    expect(mounted).not.toHaveBeenCalled();
    hover("PR");
    expect(mounted).toHaveBeenCalledWith("PR");
    hover("Commit");
    expect(unmounted).toHaveBeenCalledWith("PR");
    expect(mounted).toHaveBeenCalledWith("Commit");
    expect(document.querySelectorAll("[data-hover-card]")).toHaveLength(1);
    act(() => {
      container
        .querySelector('[data-card="Commit"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-hover-card]")).toBeNull();
    expect(unmounted).toHaveBeenCalledWith("Commit");
  });
  it("renders the child without mounting content when identity is missing", () => {
    act(() => root.render(card(null, "Unavailable")));
    hover("Unavailable");
    expect(container.querySelector("button")).not.toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    expect(document.querySelector("[data-hover-card]")).toBeNull();
  });
  it("updates an open preview from current props", () => {
    act(() => root.render(card("pr:1", "Before")));
    hover("Before");
    act(() => root.render(card("pr:1", "After")));
    expect(document.querySelector("[data-hover-card]")?.textContent).toBe(
      "After"
    );
    expect(unmounted).toHaveBeenCalledWith("Before");
  });
});
