// @vitest-environment jsdom
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import React, { act } from "react";
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

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import {
  chatPanelDraggingAtom,
  chatWidthAtom,
} from "@src/store/ui/chatPanel/widthAtoms";
import {
  collapseWorkstationAtom,
  dockWorkstationAtom,
  floatWorkstationAtom,
} from "@src/store/workstation/presentationAtoms";

import {
  resolveWorkbenchEvaluationWidth,
  useNarrowChatFocus,
} from "../useNarrowChatFocus";

describe("resolveWorkbenchEvaluationWidth", () => {
  it("uses the projected target width during programmatic reopening", () => {
    expect(
      resolveWorkbenchEvaluationWidth({
        chatPanelDragging: false,
        chatPanelMaximized: false,
        chatVisible: true,
        chatWidth: 520,
        mainContentWidth: 1280,
        measuredWorkbenchWidth: 24,
      })
    ).toBe(760);
  });

  it("uses the projected target width while chat is maximized", () => {
    expect(
      resolveWorkbenchEvaluationWidth({
        chatPanelDragging: false,
        chatPanelMaximized: true,
        chatVisible: true,
        chatWidth: 520,
        mainContentWidth: 1280,
        measuredWorkbenchWidth: 0,
      })
    ).toBe(760);
  });

  it("uses the measured width during direct chat resizing", () => {
    expect(
      resolveWorkbenchEvaluationWidth({
        chatPanelDragging: true,
        chatPanelMaximized: false,
        chatVisible: true,
        chatWidth: 520,
        mainContentWidth: 1280,
        measuredWorkbenchWidth: 472,
      })
    ).toBe(472);
  });
});

function NarrowChatFocusProbe() {
  useNarrowChatFocus();
  return null;
}

describe("useNarrowChatFocus observer lifecycle", () => {
  let container: HTMLDivElement;
  let mainContent: HTMLDivElement;
  let workbench: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    mainContent = document.createElement("div");
    workbench = document.createElement("div");
    mainContent.setAttribute("data-main-content", "");
    workbench.setAttribute("data-workbench-surface", "");
    mainContent.appendChild(workbench);
    document.body.append(container, mainContent);
    root = createRoot(container);

    vi.spyOn(mainContent, "getBoundingClientRect").mockReturnValue({
      width: 1280,
    } as DOMRect);
    vi.spyOn(workbench, "getBoundingClientRect").mockReturnValue({
      width: 760,
    } as DOMRect);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mainContent.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each([800, 1400])(
    "pauses while undocked and evaluates current %dpx bounds on docking",
    (returnWidth) => {
      const observers: ResizeObserverMock[] = [];
      class ResizeObserverMock {
        readonly observe = vi.fn();
        readonly unobserve = vi.fn();
        readonly disconnect = vi.fn();
        constructor(readonly callback: ResizeObserverCallback) {
          observers.push(this);
        }
        notify(width: number) {
          this.callback(
            [
              {
                target: mainContent,
                contentRect: new DOMRectReadOnly(0, 0, width, 800),
                borderBoxSize: [{ inlineSize: width, blockSize: 800 }],
                contentBoxSize: [{ inlineSize: width, blockSize: 800 }],
                devicePixelContentBoxSize: [
                  { inlineSize: width, blockSize: 800 },
                ],
              },
            ],
            this as unknown as ResizeObserver
          );
        }
      }
      vi.stubGlobal("ResizeObserver", ResizeObserverMock);
      const store = createStore();
      store.set(chatPanelMaximizedAtom, false);
      store.set(chatWidthAtom, 520);
      act(() =>
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(NarrowChatFocusProbe)
          )
        )
      );
      expect(store.get(chatPanelMaximizedAtom)).toBe(false);
      act(() => store.set(floatWorkstationAtom));
      expect(observers[0].disconnect).toHaveBeenCalledOnce();
      act(() => {
        observers[0].notify(400);
        store.set(chatWidthAtom, 600);
      });
      expect(store.get(chatPanelMaximizedAtom)).toBe(false);
      act(() => store.set(collapseWorkstationAtom));
      expect(observers).toHaveLength(1);
      expect(store.get(chatPanelMaximizedAtom)).toBe(false);
      vi.mocked(mainContent.getBoundingClientRect).mockReturnValue({
        width: returnWidth,
      } as DOMRect);
      act(() => store.set(dockWorkstationAtom));
      expect(observers).toHaveLength(2);
      expect(store.get(chatPanelMaximizedAtom)).toBe(returnWidth === 800);
    }
  );

  it("observes the workbench only during a direct divider drag", () => {
    const observers: ResizeObserverMock[] = [];

    class ResizeObserverMock {
      readonly observed = new Set<Element>();
      readonly observe = vi.fn((element: Element) => {
        this.observed.add(element);
      });
      readonly unobserve = vi.fn((element: Element) => {
        this.observed.delete(element);
      });
      readonly disconnect = vi.fn(() => {
        this.observed.clear();
      });

      constructor(_callback: ResizeObserverCallback) {
        observers.push(this);
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const store = createStore();

    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(NarrowChatFocusProbe)
        )
      );
    });

    expect(observers).toHaveLength(1);
    expect(observers[0].observed.has(mainContent)).toBe(true);
    expect(observers[0].observed.has(workbench)).toBe(false);

    act(() => store.set(chatPanelDraggingAtom, true));
    expect(observers[0].observed.has(workbench)).toBe(true);

    act(() => store.set(chatPanelDraggingAtom, false));
    expect(observers[0].observed.has(workbench)).toBe(false);
    expect(observers[0].unobserve).toHaveBeenCalledWith(workbench);

    act(() => root.unmount());
    root = createRoot(container);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });
});
