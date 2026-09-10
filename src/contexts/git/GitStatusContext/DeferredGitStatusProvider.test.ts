// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeferredGitStatusProvider } from "./DeferredGitStatusProvider";
import {
  DEFERRED_MOUNT_FALLBACK_MS,
  DEFERRED_MOUNT_TIMEOUT_MS,
} from "./constants";
import { useGitStatus } from "./useGitStatus";

vi.mock("./GitStatusProvider", async () => {
  const { GitStatusContext } = await import("./context");
  return {
    GitStatusProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(
        GitStatusContext.Provider,
        {
          value: {
            currentGitStatus: null,
            scopedGitStatus: null,
            gitSuggestedAction: null,
            loading: false,
            error: "active provider",
            hasActiveRepo: true,
            forceRefresh: async () => {},
          },
        },
        children
      ),
  };
});

function Reader() {
  const value = useGitStatus();
  return createElement("span", null, value.loading ? "loading" : value.error);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deferred Git status context handoff", () => {
  it("keeps readers on the shared context when the fallback mounts the provider", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(DeferredGitStatusProvider, null, createElement(Reader))
      )
    );
    expect(host.textContent).toBe("loading");
    await act(async () => vi.advanceTimersByTime(DEFERRED_MOUNT_FALLBACK_MS));
    expect(host.textContent).toBe("active provider");
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending idle mount when closed before readiness", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const request = vi.fn(() => 42);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        createElement(DeferredGitStatusProvider, null, createElement(Reader))
      )
    );
    expect(request).toHaveBeenCalledWith(expect.any(Function), {
      timeout: DEFERRED_MOUNT_TIMEOUT_MS,
    });
    await act(async () => root.unmount());
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
