// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CustomScrollbar } from "@src/components/CustomScrollbar";
import { useWindowDrag } from "@src/components/FloatingWindow/useWindowDrag";
import { useWindowResize } from "@src/components/FloatingWindow/useWindowResize";
import { useGanttDrag } from "@src/features/GanttChart/hooks/useGanttDrag";
import {
  ResizeProvider,
  useResizeManager,
} from "@src/scaffold/Resize/ResizeManager";
import ResizableSplitPanel from "@src/scaffold/Resize/components/ResizableSplitPanel";
import SplitGroup from "@src/scaffold/Resize/components/SplitGroup";
import { useColumnResize } from "@src/scaffold/Resize/hooks/useColumnResize";
import { useResizeController } from "@src/scaffold/Resize/hooks/useResizeController";

vi.mock("@src/hooks/ui/useResizeContextMenu", () => ({
  useResizeContextMenu: () => undefined,
}));
vi.mock("@src/util/ui/transientScrollbars", () => ({
  clearTransientScrollbar: vi.fn(),
  revealTransientScrollbar: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
const commit = vi.fn();
const rect = {
  left: 0,
  top: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
} as DOMRect;
function send(
  target: EventTarget,
  type: string,
  x = 0,
  buttons = 1,
  pointerId = 7
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: x,
    buttons,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  act(() => target.dispatchEvent(event));
}
function interrupt(reason: string, pointer = false) {
  if (reason === "hidden") {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
  } else if (reason === "pointercancel") {
    send(window, "pointercancel", 0, 0);
  } else if (reason === "released-move")
    send(window, pointer ? "pointermove" : "mousemove", 400, 0);
  else if (reason === "unmount") act(() => root.render(null));
  else act(() => window.dispatchEvent(new Event(reason)));
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  commit.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.cssText = "";
  document.body.classList.remove("resize-active");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function FloatingHarness({ kind }: { kind: "drag" | "resize" }) {
  const drag = useWindowDrag(true);
  const resize = useWindowResize({ minWidth: 100, minHeight: 100 });
  return createElement(
    "div",
    { "data-draggable-window": "" },
    createElement("div", {
      "data-handle": "",
      onPointerDown: kind === "drag" ? drag : resize("se"),
    })
  );
}
for (const kind of ["drag", "resize"] as const) {
  it.each(["blur", "hidden", "pointercancel", "released-move", "unmount"])(
    `floating ${kind} stops on %s`,
    (reason) => {
      act(() => root.render(createElement(FloatingHarness, { kind })));
      const panel = host.firstElementChild as HTMLElement;
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
        ...rect,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
      });
      const handle = host.querySelector("[data-handle]")!;
      send(handle, "pointerdown");
      send(window, "pointermove", 30);
      const before =
        kind === "drag" ? panel.style.transform : panel.style.width;
      expect(before).toBe(
        kind === "drag" ? "translate3d(30px, 30px, 0)" : "230px"
      );
      interrupt(reason, true);
      send(window, "pointermove", 100);
      send(window, "pointerup", 100, 0);
      expect(kind === "drag" ? panel.style.transform : panel.style.width).toBe(
        before
      );
      expect(document.body.style.cursor).toBe("");
    }
  );
}
function ColumnHarness() {
  const { columnRef, handleMouseDown, isResizing } = useColumnResize({
    width: 200,
    setWidth: commit,
    min: 100,
    max: 500,
  });
  useEffect(() => {
    columnRef.current = host;
  }, [columnRef]);
  return createElement("div", {
    "data-handle": "",
    "data-resizing": isResizing,
    onMouseDown: handleMouseDown,
  });
}
function ControllerHarness() {
  const api = useResizeController({
    axis: "x",
    min: 100,
    max: 500,
    onCommit: commit,
  });
  const manager = useResizeManager();
  return createElement("div", {
    "data-handle": "",
    "data-resizing": manager.isResizing,
    onMouseDown: (e) => api.start(e, 200),
  });
}
for (const kind of ["column", "controller", "split", "group"] as const) {
  it.each([
    "blur",
    "hidden",
    "pointercancel",
    "released-move",
    "mouseup",
    "unmount",
  ])(`${kind} resize stops on %s`, (reason) => {
    const child =
      kind === "column"
        ? createElement(ColumnHarness)
        : kind === "controller"
          ? createElement(ControllerHarness)
          : kind === "split"
            ? createElement(ResizableSplitPanel, {
                defaultLeftWidth: 200,
                leftPanel: "left",
                rightPanel: "right",
                onSplitChange: commit,
              })
            : jsx(SplitGroup, {
                axis: "x",
                sizes: [200, 200],
                onSizesChange: commit,
                children: ["left", "right"],
              });
    act(() => root.render(createElement(ResizeProvider, null, child)));
    const handle = host.querySelector("[data-handle], [role=separator]")!;
    expect(handle).not.toBeNull();
    send(handle, "mousedown");
    send(window, "mousemove", 30);
    if (reason === "mouseup") send(handle, "mouseup", 30, 0);
    else interrupt(reason);
    const count = commit.mock.calls.length;
    send(window, "mousemove", 200);
    send(window, "mouseup", 200, 0);
    act(() => vi.advanceTimersByTime(30));
    expect(commit).toHaveBeenCalledTimes(count);
    if (reason !== "unmount") {
      expect(commit).toHaveBeenLastCalledWith(
        kind === "group" ? [230, 170] : 230
      );
      send(handle, "mousedown");
      send(window, "mouseup", 0, 0);
      expect(document.body.classList.contains("resize-active")).toBe(false);
    }
    expect(document.body.style.cursor).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
}
function GanttHarness() {
  const api = useGanttDrag({
    viewScope: "1d",
    columnWidth: 24,
    viewStart: new Date("2026-09-08T00:00:00Z"),
    onTaskUpdate: commit,
  });
  return createElement("div", {
    "data-active": !!api.dragState,
    "data-preview": !!api.ghostPreview,
    onMouseDown: (e) =>
      api.handleMoveStart(
        "task",
        new Date("2026-09-08T00:00:00Z"),
        new Date("2026-09-10T00:00:00Z"),
        e
      ),
  });
}
it.each(["blur", "hidden", "pointercancel", "released-move"])(
  "Gantt cancels preview without writing dates on %s",
  (reason) => {
    act(() => root.render(createElement(GanttHarness)));
    const handle = host.firstElementChild!;
    send(handle, "mousedown");
    send(window, "mousemove", 24);
    expect(handle.getAttribute("data-preview")).toBe("true");
    interrupt(reason);
    send(window, "mousemove", 48);
    send(window, "mouseup", 48, 0);
    expect(handle.getAttribute("data-active")).toBe("false");
    expect(handle.getAttribute("data-preview")).toBe("false");
    expect(commit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  }
);
it("Gantt still commits an ordinary release once", () => {
  act(() => root.render(createElement(GanttHarness)));
  send(host.firstElementChild!, "mousedown");
  send(window, "mousemove", 24);
  send(window, "mouseup", 24, 0);
  expect(commit).toHaveBeenCalledTimes(1);
});
it.each(["blur", "hidden", "pointercancel", "released-move", "unmount"])(
  "scrollbar stops moving the scroller on %s",
  (reason) => {
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 100 },
    });
    act(() =>
      root.render(
        createElement(CustomScrollbar, {
          scrollElement: scroller,
          totalLines: 100,
        })
      )
    );
    const track = host.querySelector(".custom-scrollbar-track")!;
    Object.defineProperty(track, "clientHeight", { value: 100 });
    act(() => vi.advanceTimersByTime(20));
    send(host.querySelector(".custom-scrollbar-thumb")!, "mousedown");
    send(window, "mousemove", 10);
    const before = scroller.scrollTop;
    expect(before).toBeGreaterThan(0);
    interrupt(reason);
    send(window, "mousemove", 70);
    send(window, "mouseup", 70, 0);
    expect(scroller.scrollTop).toBe(before);
    expect(document.body.style.cursor).toBe("");
  }
);
