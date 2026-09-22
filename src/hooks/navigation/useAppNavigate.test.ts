// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppNavigate } from "./useAppNavigate";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(...args: unknown[]) => void | Promise<void>>(),
  error: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: mocks.error }),
}));

const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function renderHook(hook: typeof useAppNavigate) {
  const result = { current: undefined as unknown as ReturnType<typeof hook> };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    result.current = hook();
    return null;
  }
  const rerender = () => act(() => root.render(React.createElement(Probe)));
  rerender();
  cleanups.push(() => act(() => root.unmount()));
  return { result, rerender };
}

describe("useAppNavigate", () => {
  it("forwards destination and return state immediately without exposing a promise", () => {
    mocks.navigate.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAppNavigate());
    const options = { replace: true, state: { returnTo: "/chat?tab=1#last" } };
    expect(result.current("/reauth", options)).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledWith("/reauth", options);
  });

  it("preserves calls without navigation options", () => {
    const { result } = renderHook(() => useAppNavigate());
    result.current("/chat");
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/chat");
  });

  it("forwards history deltas and supports synchronous routers", () => {
    const { result } = renderHook(() => useAppNavigate());
    expect(result.current(-1)).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });

  it("reports rejected navigation completions", async () => {
    const error = new Error("navigation failed");
    mocks.navigate.mockRejectedValue(error);
    const { result } = renderHook(() => useAppNavigate());
    await act(async () => result.current("/chat"));
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      "Navigation failed",
      error
    );
  });

  it("keeps callback identity when the router navigation function is unchanged", () => {
    const { result, rerender } = renderHook(() => useAppNavigate());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
