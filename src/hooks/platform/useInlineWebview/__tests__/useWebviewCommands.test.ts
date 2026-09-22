import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UseWebviewCommandsParams } from "../useWebviewCommands";

const invokeMock = vi.fn();

vi.mock("react", () => ({
  useCallback: <Callback extends (...args: never[]) => unknown>(
    callback: Callback
  ) => callback,
  useRef: <Value>(value: Value) => ({ current: value }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

function createParams(
  overrides: Partial<UseWebviewCommandsParams> = {}
): UseWebviewCommandsParams {
  return {
    isWebviewAvailable: true,
    isUnmountedRef: { current: false },
    containerRef: { current: null },
    labelRef: { current: "browser-session-test" },
    userAgent: "test-agent",
    incognito: false,
    isDestroyedRef: { current: false },
    pollIntervalRef: { current: null },
    lastPolledUrlRef: { current: "https://example.com" },
    getContainerRect: () => null,
    log: vi.fn(),
    isWebviewCreated: true,
    setIsWebviewCreated: vi.fn(),
    setIsLoading: vi.fn(),
    setCurrentUrl: vi.fn(),
    setError: vi.fn(),
    isVisible: true,
    ...overrides,
  };
}

describe("useWebviewCommands reload", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("uses native reload without closing or recreating the inline webview", async () => {
    const { useWebviewCommands } = await import("../useWebviewCommands");
    const setIsLoading = vi.fn();
    const commands = useWebviewCommands(createParams({ setIsLoading }));

    await commands.reload();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("reload_inline_webview", {
      label: "browser-session-test",
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "close_inline_webview",
      expect.anything()
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "create_inline_webview",
      expect.anything()
    );
    expect(setIsLoading).toHaveBeenNthCalledWith(1, true);
    expect(setIsLoading).toHaveBeenNthCalledWith(2, false);
  });

  it("does not invoke Tauri when the webview has not been created", async () => {
    const { useWebviewCommands } = await import("../useWebviewCommands");
    const setIsLoading = vi.fn();
    const commands = useWebviewCommands(
      createParams({ isWebviewCreated: false, setIsLoading })
    );

    await commands.reload();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(setIsLoading).not.toHaveBeenCalled();
  });
});

describe("useWebviewCommands navigate", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("loads the URL directly when the navigation is not a history step", async () => {
    const { useWebviewCommands } = await import("../useWebviewCommands");
    const commands = useWebviewCommands(
      createParams({ resolveHistoryDirection: () => null })
    );

    await commands.navigate("https://next.example");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("navigate_inline_webview", {
      label: "browser-session-test",
      url: "https://next.example",
    });
  });

  it("restores a Back step from the native list without loading the URL", async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === "traverse_inline_webview_history")
    );
    const { useWebviewCommands } = await import("../useWebviewCommands");
    const onNavigate = vi.fn();
    const commands = useWebviewCommands(
      createParams({ onNavigate, resolveHistoryDirection: () => "back" })
    );

    await commands.navigate("https://previous.example");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("traverse_inline_webview_history", {
      label: "browser-session-test",
      url: "https://previous.example",
      direction: "back",
    });
    expect(onNavigate).toHaveBeenCalledWith("https://previous.example");
  });

  it.each([
    ["the native list does not hold the URL", () => Promise.resolve(false)],
    ["the traversal command fails", () => Promise.reject(new Error("boom"))],
  ])("loads the URL as before when %s", async (_case, traverse) => {
    invokeMock.mockImplementation((command: string) =>
      command === "traverse_inline_webview_history"
        ? traverse()
        : Promise.resolve(undefined)
    );
    const { useWebviewCommands } = await import("../useWebviewCommands");
    const commands = useWebviewCommands(
      createParams({ resolveHistoryDirection: () => "forward" })
    );

    await commands.navigate("https://next.example");

    expect(invokeMock.mock.calls.map(([command]) => String(command))).toEqual([
      "traverse_inline_webview_history",
      "navigate_inline_webview",
    ]);
    expect(invokeMock).toHaveBeenLastCalledWith("navigate_inline_webview", {
      label: "browser-session-test",
      url: "https://next.example",
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "close_inline_webview",
      expect.anything()
    );
  });
});

describe("useWebviewCommands lifecycle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("shares overlapping create requests and releases one ref-count slot", async () => {
    let finishCreate: (() => void) | undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "create_inline_webview") {
        return new Promise<void>((resolve) => {
          finishCreate = resolve;
        });
      }
      return Promise.resolve();
    });

    const { useWebviewCommands } = await import("../useWebviewCommands");
    const rect = {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const commands = useWebviewCommands(
      createParams({
        isWebviewCreated: false,
        containerRef: { current: {} as HTMLDivElement },
        getContainerRect: () => rect,
      })
    );

    const first = commands.createWebview("https://example.com");
    const second = commands.createWebview("https://example.com");

    expect(second).toBe(first);
    expect(
      invokeMock.mock.calls.filter(([command]) =>
        Object.is(command, "create_inline_webview")
      )
    ).toHaveLength(1);

    finishCreate?.();
    await Promise.all([first, second]);
    await commands.destroy();

    expect(
      invokeMock.mock.calls.filter(([command]) =>
        Object.is(command, "close_inline_webview")
      )
    ).toHaveLength(1);
  });
});
