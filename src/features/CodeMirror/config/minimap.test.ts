// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { minimapExtension } from "./minimap";

const paint = {
  setTransform: vi.fn(),
  scale: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: "",
};
const mounted: EditorView[] = [];
const observers: {
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];

function mount(lines = 1000) {
  const host = document.createElement("div");
  document.body.append(host);
  let height = 208;
  Object.defineProperty(host, "clientHeight", { get: () => height });
  vi.spyOn(host, "getBoundingClientRect").mockImplementation(() => ({
    width: 80,
    height,
    top: 0,
    left: 0,
    right: 80,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {},
  }));
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: Array.from({ length: lines }, () => "\tx  y").join("\n"),
      extensions: [minimapExtension({ current: host })],
    }),
  });
  mounted.push(view);
  Object.defineProperties(view.scrollDOM, {
    clientHeight: { value: 200 },
    scrollHeight: { value: lines * 20 },
  });
  vi.spyOn(view, "documentPadding", "get").mockReturnValue({
    top: 0,
    bottom: 0,
  });
  vi.spyOn(view, "lineBlockAtHeight").mockImplementation((height) => {
    const index = Math.min(lines - 1, Math.max(0, Math.floor(height / 20)));
    const line = view.state.doc.line(index + 1);
    return {
      from: line.from,
      to: line.to,
      top: index * 20,
      bottom: (index + 1) * 20,
      height: 20,
    } as ReturnType<EditorView["lineBlockAtHeight"]>;
  });
  return {
    host,
    view,
    resize: (next: number) => {
      height = next;
      observers.forEach((observer) =>
        observer.callback(
          [{ contentRect: { height } } as ResizeObserverEntry],
          {} as ResizeObserver
        )
      );
    },
  };
}
const frame = () => vi.advanceTimersByTimeAsync(50);
const mouse = (target: EventTarget, type: string, y: number, button = 0) =>
  target.dispatchEvent(
    new MouseEvent(type, {
      clientY: y,
      button,
      bubbles: true,
      cancelable: true,
    })
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    paint as unknown as CanvasRenderingContext2D
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    }
  );
});
afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  observers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CodeMirror minimap", () => {
  it("bounds the drawing, reuses it for small scrolls, and renders the last line on a large jump", async () => {
    const { host, view } = mount();
    await frame();
    const canvas = host.querySelector("canvas")!;
    expect(canvas.style.height).toBe("464px");
    expect(paint.fillRect).toHaveBeenCalledTimes(460);
    paint.clearRect.mockClear();
    view.scrollDOM.scrollTop = 500;
    for (let i = 0; i < 20; i++)
      view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frame();
    expect(paint.clearRect).not.toHaveBeenCalled();
    paint.fillRect.mockClear();
    view.scrollDOM.scrollTop = 19800;
    for (let i = 0; i < 20; i++)
      view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frame();
    expect(canvas.style.transform).toBe("translateY(-256px)");
    expect(paint.fillRect.mock.calls.some((call) => call[1] === 458)).toBe(
      true
    );
    expect(
      (host.querySelector(".minimap-viewport") as HTMLElement).style.transform
    ).toBe("translateY(184px)");
    expect(paint.clearRect).toHaveBeenCalledTimes(1);
    expect(paint.fillRect.mock.calls.length).toBeLessThanOrEqual(464);
  });

  it("keeps backing pixels independent of document length and avoids reallocating on edits", async () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    const { host, view } = mount(1499);
    await frame();
    const canvas = host.querySelector("canvas")!;
    expect(canvas.width * canvas.height * 4).toBe(593920);
    const width = vi.spyOn(canvas, "width", "set");
    const height = vi.spyOn(canvas, "height", "set");
    view.dispatch({ changes: { from: 1, to: 2, insert: "z" } });
    await frame();
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
  });

  it("renders offscreen edits when entering the buffer and can scroll back to the start", async () => {
    const { host, view } = mount();
    await frame();
    const last = view.state.doc.line(1000);
    view.dispatch({
      changes: { from: last.from, to: last.to, insert: "last" },
    });
    await frame();
    paint.fillRect.mockClear();
    view.scrollDOM.scrollTop = 19800;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frame();
    expect(
      paint.fillRect.mock.calls.filter((call) => call[1] === 458)
    ).toHaveLength(4);
    paint.fillRect.mockClear();
    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frame();
    expect(host.querySelector("canvas")!.style.transform).toBe(
      "translateY(0px)"
    );
    expect(
      paint.fillRect.mock.calls.filter((call) => call[1] === 4)
    ).toHaveLength(2);
  });

  it("releases a collapsed host's canvas and restores it on resize", async () => {
    const { host, resize } = mount();
    await frame();
    const canvas = host.querySelector("canvas")!;
    resize(0);
    await frame();
    expect(canvas.width * canvas.height).toBe(0);
    paint.clearRect.mockClear();
    await vi.advanceTimersByTimeAsync(500);
    expect(paint.clearRect).not.toHaveBeenCalled();
    resize(208);
    await frame();
    expect(canvas.height).toBe(464);
    expect(paint.clearRect).toHaveBeenCalledTimes(1);
  });

  it("preserves the slider grab position, drags to the end, and releases on blur", async () => {
    const { host, view } = mount();
    await frame();
    mouse(host, "mousedown", 10);
    expect(view.scrollDOM.scrollTop).toBe(0);
    mouse(document, "mousemove", 190);
    expect(view.scrollDOM.scrollTop).toBe(19800);
    window.dispatchEvent(new Event("blur"));
    mouse(document, "mousemove", 0);
    expect(view.scrollDOM.scrollTop).toBe(19800);
    expect(host.classList.contains("minimap-dragging")).toBe(false);
  });

  it("clicks the visible code after scrolling and ignores right clicks", async () => {
    const { host, view } = mount();
    await frame();
    view.scrollDOM.scrollTop = 19800;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await frame();
    const block = vi.spyOn(view, "lineBlockAt");
    mouse(host, "mousedown", 50, 2);
    expect(block).not.toHaveBeenCalled();
    mouse(host, "mousedown", 50);
    expect(block).toHaveBeenCalledWith(view.state.doc.line(924).from);
  });

  it("keeps short files at the top and respects tabs and whitespace", async () => {
    const { host } = mount(3);
    await frame();
    const slider = host.querySelector(".minimap-viewport") as HTMLElement;
    expect(slider.style.height).toBe("6px");
    expect(slider.style.transform).toBe("translateY(4px)");
    expect(
      paint.fillRect.mock.calls
        .filter((call) => call[1] === 4)
        .map((call) => call[0])
    ).toEqual([8, 11]);
  });

  it("projects a wrapped line into its code row instead of a file-wide scroll ratio", async () => {
    const { host, view } = mount();
    vi.spyOn(view, "lineBlockAtHeight").mockImplementation(() => {
      const line = view.state.doc.line(1);
      return {
        from: line.from,
        to: line.to,
        top: 0,
        bottom: 1000,
        height: 1000,
      } as ReturnType<EditorView["lineBlockAtHeight"]>;
    });
    view.scrollDOM.scrollTop = 500;
    await frame();
    expect(
      (host.querySelector(".minimap-viewport") as HTMLElement).style.transform
    ).toBe("translateY(5px)");
  });

  it("coalesces edits outside the update cycle and isolates mounted editors", async () => {
    const first = mount();
    const second = mount();
    await frame();
    paint.clearRect.mockClear();
    for (let index = 0; index < 10; index++)
      first.view.dispatch({
        changes: { from: 1, to: 2, insert: String(index) },
      });
    expect(paint.clearRect).not.toHaveBeenCalled();
    await frame();
    expect(paint.clearRect).toHaveBeenCalledTimes(1);
    first.view.destroy();
    mounted.splice(mounted.indexOf(first.view), 1);
    expect(second.host.querySelector("canvas")).not.toBeNull();
    paint.clearRect.mockClear();
    await vi.advanceTimersByTimeAsync(500);
    expect(paint.clearRect).not.toHaveBeenCalled();
  });

  it("forwards wheel deltas, redraws on resize, and stops hidden or destroyed work", async () => {
    const { host, view, resize } = mount();
    await frame();
    const canvas = host.querySelector("canvas")!;
    host.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 2, deltaMode: 2, cancelable: true })
    );
    expect(view.scrollDOM.scrollTop).toBe(400);
    paint.clearRect.mockClear();
    resize(308);
    await frame();
    expect(paint.clearRect).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(canvas.width * canvas.height).toBe(0);
    paint.clearRect.mockClear();
    resize(408);
    await frame();
    expect(paint.clearRect).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await frame();
    expect(paint.clearRect).toHaveBeenCalledTimes(1);
    expect(canvas.width * canvas.height).toBeGreaterThan(0);
    resize(508);
    view.destroy();
    mounted.pop();
    paint.clearRect.mockClear();
    await frame();
    expect(host.children).toHaveLength(0);
    expect(canvas.width * canvas.height).toBe(0);
    expect(paint.clearRect).not.toHaveBeenCalled();
    expect(
      observers.every((observer) => observer.disconnect.mock.calls.length > 0)
    ).toBe(true);
  });
});
