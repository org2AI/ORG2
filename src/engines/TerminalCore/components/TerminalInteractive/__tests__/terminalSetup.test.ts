import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeWhenContainerVisible } from "../terminalSetup";

let frame: FrameRequestCallback;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  disconnect = vi.fn();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    })
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
  );
  vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let rendererCellWidth = 9;
  const terminal = { cols: 80, rows: 24 };
  const initPty = vi.fn();
  const fitTerminal = vi.fn(() => {
    terminal.cols = Math.floor(560 / rendererCellWidth);
  });
  const container = {
    getBoundingClientRect: () => ({ width: 560, height: 300 }),
  };
  const cleanup = initializeWhenContainerVisible({
    containerRef: { current: container },
    terminal,
    fitTerminal,
    loadWebGL: () => {
      rendererCellWidth = 8.5;
    },
    setIsReady: vi.fn(),
    initPty,
  } as unknown as Parameters<typeof initializeWhenContainerVisible>[0]);
  return { cleanup, initPty, fitTerminal, container };
}

describe("terminal startup sizing", () => {
  it("fits the active renderer before launching exactly one PTY", async () => {
    const state = setup();
    frame(0);
    resize();
    await Promise.resolve();
    expect(state.initPty).toHaveBeenCalledExactlyOnceWith(65, 24);
    expect(state.fitTerminal).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    state.cleanup();
  });

  it("waits for visibility without polling and does no work after cleanup", async () => {
    const state = setup();
    state.container.getBoundingClientRect = () => ({ width: 0, height: 0 });
    frame(0);
    await Promise.resolve();
    expect(state.initPty).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    state.container.getBoundingClientRect = () => ({ width: 560, height: 300 });
    resize();
    state.cleanup();
    await Promise.resolve();
    expect(state.initPty).not.toHaveBeenCalled();
    expect(state.fitTerminal).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
