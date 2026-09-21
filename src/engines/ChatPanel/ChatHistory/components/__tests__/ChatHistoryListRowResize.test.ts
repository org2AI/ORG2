// @vitest-environment jsdom
/**
 * A pane resize re-wraps every mounted turn. The virtualizer learns the new
 * heights from a ResizeObserver, and the row offsets must be committed inside
 * that callback: a render left to React's scheduler lands after the browser
 * has painted the re-wrapped rows at their old offsets, which reads as the
 * transcript bouncing on every frame of the drag.
 */
import { type MutableRefObject, act, createElement, createRef } from "react";
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

import { HIDDEN_AGENT_STATUS_TRAIL_STATE } from "@src/engines/ChatPanel/hooks/agentStatusTrailMath";

import type { OptimizedChatItem } from "../../chatItemPipeline/types";
import ChatHistoryList from "../ChatHistoryList";
import type {
  ChatHistoryListHandle,
  ChatHistoryListProps,
} from "../ChatHistoryListTypes";

const ESTIMATED_ROW_SIZE = 360;

const virtualizerState = vi.hoisted(() => ({
  sizes: new Map<number, number>(),
}));

vi.mock("@tanstack/react-virtual", async () => {
  const { useReducer } = await vi.importActual<typeof import("react")>("react");
  return {
    useVirtualizer: (options: {
      count: number;
      getItemKey: (index: number) => string | number;
    }) => {
      // Mirrors TanStack: a size change notifies through a plain reducer
      // dispatch, which React schedules unless it runs inside flushSync.
      const [, notify] = useReducer((revision: number) => revision + 1, 0);
      let start = 0;
      const items = Array.from({ length: options.count }, (_, index) => {
        const size = virtualizerState.sizes.get(index) ?? ESTIMATED_ROW_SIZE;
        const item = { index, key: options.getItemKey(index), start, size };
        start += size;
        return item;
      });
      return {
        getTotalSize: () => start,
        getVirtualItems: () => items,
        indexFromElement: (node: Element) =>
          Number(node.getAttribute("data-index")),
        measureElement: () => undefined,
        resizeItem: (index: number, size: number) => {
          virtualizerState.sizes.set(index, size);
          notify();
        },
        scrollToIndex: () => undefined,
      };
    },
  };
});

vi.mock("../../renderers", () => ({
  GroupItemRenderer: () => null,
}));

function bodyItem(index: number): OptimizedChatItem {
  return {
    chunk_id: `body-${index}`,
    type: "activity",
    event: { id: `event-${index}` },
  } as OptimizedChatItem;
}

describe("ChatHistoryList row resize", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallback: ResizeObserverCallback | null;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const noop = () => undefined;
  const virtualScrollerRef: MutableRefObject<HTMLDivElement | null> = {
    current: null,
  };

  function listProps(onRowLayoutCommit: () => void): ChatHistoryListProps {
    // Two turns of 13 items: over the static-rendering limit.
    const flatItems = Array.from({ length: 26 }, (_, index) => bodyItem(index));
    return {
      flatItems,
      groupCounts: [13, 13],
      turnIds: ["turn-a", "turn-b"],
      totalFlatItems: flatItems.length,
      footerSpacerHeight: 0,
      bottomInset: 0,
      topPaddingPx: 0,
      planningIndicatorCount: 0,
      planningVariantIndex: 0,
      planningFooterMode: "planning",
      statusTrail: HIDDEN_AGENT_STATUS_TRAIL_STATE,
      statusTrailSessionId: null,
      virtualListRef: createRef<ChatHistoryListHandle>(),
      virtualListDataKey: "row-resize",
      getIsWpGeneWorking: () => false,
      renderGroupHeader: () => null,
      onAtBottomStateChange: noop,
      onRangeChanged: noop,
      onEndReached: noop,
      virtualScrollerRef,
      onRowLayoutCommit,
    };
  }

  const row = (index: number) =>
    container.querySelector<HTMLElement>(`[data-index="${index}"]`)!;

  const resize = (index: number, blockSize: number) =>
    resizeCallback!(
      [
        {
          target: row(index),
          borderBoxSize: [{ blockSize, inlineSize: 480 }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver
    );

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => undefined;
  });

  beforeEach(() => {
    virtualizerState.sizes.clear();
    resizeCallback = null;
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("commits re-wrapped row offsets inside the observer callback, then reconciles the viewport", () => {
    const committedOffsetsAtReconcile: string[] = [];
    const onRowLayoutCommit = vi.fn(() => {
      committedOffsetsAtReconcile.push(row(1).style.transform);
    });
    act(() =>
      root.render(createElement(ChatHistoryList, listProps(onRowLayoutCommit)))
    );
    expect(row(1).style.transform).toBe(`translateY(${ESTIMATED_ROW_SIZE}px)`);

    act(() => {
      resize(0, 520);
      // Asserted before act flushes React's queue: only a synchronous commit
      // can already show the new offset here.
      expect(row(1).style.transform).toBe("translateY(520px)");
    });
    expect(onRowLayoutCommit).toHaveBeenCalledOnce();
    expect(committedOffsetsAtReconcile).toEqual(["translateY(520px)"]);
  });

  it("ignores observer notifications that match the committed row sizes", () => {
    const onRowLayoutCommit = vi.fn();
    act(() =>
      root.render(createElement(ChatHistoryList, listProps(onRowLayoutCommit)))
    );

    act(() => resize(0, ESTIMATED_ROW_SIZE + 0.4));

    expect(onRowLayoutCommit).not.toHaveBeenCalled();
    expect(virtualizerState.sizes.size).toBe(0);
  });
});
