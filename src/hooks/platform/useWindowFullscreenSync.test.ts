// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
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

import { windowFullscreenAtom } from "@src/store/ui/uiAtom";

import { useWindowFullscreenSync } from "./useWindowFullscreenSync";

const {
  hasMacWindowChromeMock,
  isFullscreenMock,
  onResizedMock,
  unlistenMock,
} = vi.hoisted(() => ({
  hasMacWindowChromeMock: vi.fn(),
  isFullscreenMock: vi.fn(),
  onResizedMock: vi.fn(),
  unlistenMock: vi.fn(),
}));

vi.mock("@src/config/windowChromeRadius", () => ({
  hasMacWindowChrome: hasMacWindowChromeMock,
}));
vi.mock("@src/util/platform/tauri/safeUnlisten", () => ({
  safeUnlisten: (fn: (() => void) | null | undefined) => fn?.(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: isFullscreenMock,
    onResized: onResizedMock,
  }),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const Harness = () => {
  useWindowFullscreenSync();
  return null;
};

async function flush(): Promise<void> {
  // Two hops: dynamic import + isFullscreen, then onResized registration.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWindowFullscreenSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;
  let resizeHandler: (() => void) | null;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    resizeHandler = null;
    hasMacWindowChromeMock.mockReturnValue(true);
    isFullscreenMock.mockResolvedValue(false);
    onResizedMock.mockImplementation(async (handler: () => void) => {
      resizeHandler = handler;
      return unlistenMock;
    });
    store = createStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function render(): void {
    act(() => {
      root.render(createElement(Provider, { store }, createElement(Harness)));
    });
  }

  it("seeds the atom from the window and follows resize-driven changes", async () => {
    isFullscreenMock.mockResolvedValue(true);
    render();
    await flush();

    expect(store.get(windowFullscreenAtom)).toBe(true);
    expect(onResizedMock).toHaveBeenCalledTimes(1);

    // Leaving native full screen resizes the window; re-read the state.
    isFullscreenMock.mockResolvedValue(false);
    resizeHandler?.();
    await flush();
    expect(store.get(windowFullscreenAtom)).toBe(false);

    isFullscreenMock.mockResolvedValue(true);
    resizeHandler?.();
    await flush();
    expect(store.get(windowFullscreenAtom)).toBe(true);
  });

  it("unsubscribes on unmount and ignores late resizes", async () => {
    render();
    await flush();
    expect(onResizedMock).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    expect(unlistenMock).toHaveBeenCalledTimes(1);

    isFullscreenMock.mockResolvedValue(true);
    resizeHandler?.();
    await flush();
    expect(store.get(windowFullscreenAtom)).toBe(false);

    // Re-create so afterEach's unmount stays a no-op.
    root = createRoot(container);
  });

  it("does nothing outside a macOS window (other hosts, browser mode)", async () => {
    hasMacWindowChromeMock.mockReturnValue(false);
    render();
    await flush();

    expect(isFullscreenMock).not.toHaveBeenCalled();
    expect(onResizedMock).not.toHaveBeenCalled();
    expect(store.get(windowFullscreenAtom)).toBe(false);
  });
});
