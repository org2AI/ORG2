// @vitest-environment jsdom
import { type FC, type ReactNode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
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

import { ViewportLayoutMutationProvider } from "@src/components/ViewportLayoutMutationContext";

import EventBlockHeader from "./EventBlockHeader";
import { EventBlockHeaderTitle } from "./EventBlockHeaderTextSlots";
import type { EventBlockHeaderProps } from "./types";

type TestHeaderProps = Omit<EventBlockHeaderProps, "children"> & {
  children?: ReactNode;
};
const TestEventBlockHeader = EventBlockHeader as FC<TestHeaderProps>;

describe("EventBlockHeader text selection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("keeps header chrome out of the selection range", () => {
    act(() => {
      root.render(
        createElement(
          TestEventBlockHeader,
          { isCollapsed: false },
          createElement(EventBlockHeaderTitle, null, "Thought")
        )
      );
    });

    const header = container.firstElementChild;
    const title = container.querySelector("span");
    expect(header?.classList.contains("chat-block-header")).toBe(true);
    expect(title?.classList.contains("select-none")).toBe(true);
    expect(title?.classList.contains("select-text")).toBe(false);
  });

  it("does not toggle the header after dragging across its title", () => {
    const onToggleCollapse = vi.fn();
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ isCollapsed: false } as Selection);

    act(() => {
      root.render(
        createElement(
          TestEventBlockHeader,
          { isCollapsed: false, onToggleCollapse },
          createElement(EventBlockHeaderTitle, null, "Thought")
        )
      );
    });

    act(() => {
      container.firstElementChild?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(onToggleCollapse).not.toHaveBeenCalled();

    selection.mockReturnValue({ isCollapsed: true } as Selection);
    act(() => {
      container.firstElementChild?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it("keeps row expansion separate from Agent Station navigation", () => {
    const onToggleCollapse = vi.fn();
    const onNavigate = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
    } as Selection);

    act(() => {
      root.render(
        createElement(
          TestEventBlockHeader,
          { isCollapsed: true, onToggleCollapse, onNavigate },
          createElement(EventBlockHeaderTitle, null, "Ran command")
        )
      );
    });

    const header = container.firstElementChild as HTMLElement;
    const navigate = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-navigate"]'
    );

    act(() => header.click());
    expect(onToggleCollapse).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => navigate?.click());
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it("captures the viewport anchor before a collapsible event header mutates layout", () => {
    const calls: string[] = [];
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
    } as Selection);

    act(() => {
      root.render(
        createElement(
          ViewportLayoutMutationProvider,
          { value: () => calls.push("before-layout-mutation") },
          createElement(
            TestEventBlockHeader,
            {
              isCollapsed: true,
              onToggleCollapse: () => calls.push("toggle"),
            },
            createElement(EventBlockHeaderTitle, null, "Ran command")
          )
        )
      );
    });

    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click());
    expect(calls).toEqual(["before-layout-mutation", "toggle"]);
  });

  it("does not capture a layout anchor for navigation-only headers", () => {
    const beforeLayoutMutation = vi.fn();
    const onNavigate = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
    } as Selection);

    act(() => {
      root.render(
        createElement(
          ViewportLayoutMutationProvider,
          { value: beforeLayoutMutation },
          createElement(
            TestEventBlockHeader,
            { isCollapsed: true, onNavigate },
            createElement(EventBlockHeaderTitle, null, "Read file")
          )
        )
      );
    });

    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click());
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(beforeLayoutMutation).not.toHaveBeenCalled();
  });

  it("makes expandable rows use the clickable cursor", () => {
    act(() => {
      root.render(
        createElement(
          TestEventBlockHeader,
          { isCollapsed: true, onToggleCollapse: vi.fn() },
          createElement(EventBlockHeaderTitle, null, "Ran command")
        )
      );
    });

    const header = container.firstElementChild as HTMLElement;
    expect(header.classList.contains("cursor-pointer")).toBe(true);
  });

  it("reveals from the whole row when there is nothing to expand", () => {
    const onNavigate = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
    } as Selection);

    act(() => {
      root.render(
        createElement(
          TestEventBlockHeader,
          { isCollapsed: true, onNavigate },
          createElement(EventBlockHeaderTitle, null, "Read file")
        )
      );
    });

    const header = container.firstElementChild as HTMLElement;
    const navigate = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-navigate"]'
    );
    expect(header.classList.contains("cursor-pointer")).toBe(true);

    act(() => header.click());
    expect(onNavigate).toHaveBeenCalledOnce();

    act(() => navigate?.click());
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(navigate?.tabIndex).toBe(0);
    expect(navigate?.getAttribute("aria-label")).toBe("View in Agent Station");
  });
});
