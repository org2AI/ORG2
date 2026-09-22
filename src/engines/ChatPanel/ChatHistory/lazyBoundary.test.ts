// @vitest-environment jsdom
import React, {
  act,
  createContext,
  createElement,
  useContext,
  useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryProps } from "./ChatHistory.types";

const SessionContext = createContext("none");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.doUnmock("./ChatHistory");
  vi.restoreAllMocks();
});

describe("chat history loading boundary", () => {
  it("loads on mount, uses the latest reader context and preserves mounted readers", async () => {
    vi.resetModules();
    const gate = deferred();
    const load = vi.fn();
    const mount = vi.fn();
    const unmount = vi.fn();
    vi.doMock("./ChatHistory", async () => {
      load();
      await gate.promise;
      return {
        default: function Reader({ displayMode }: ChatHistoryProps) {
          const session = useContext(SessionContext);
          useEffect(() => {
            mount();
            return unmount;
          }, []);
          return createElement("div", { "data-reader": session }, displayMode);
        },
      };
    });
    const { default: ChatHistory } = await import("./index");
    expect(load).not.toHaveBeenCalled();

    const host = document.createElement("div");
    const root = createRoot(host);
    const renderReaders = (session: string, sideChat: boolean) =>
      createElement(
        SessionContext.Provider,
        { value: session },
        createElement(ChatHistory, { key: "main", displayMode: "compact" }),
        sideChat && createElement(ChatHistory, { key: "side" })
      );
    try {
      await act(async () => root.render(renderReaders("old", true)));
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      expect(
        host.querySelectorAll('[data-testid="chat-loading-block"]')
      ).toHaveLength(2);
      expect(mount).not.toHaveBeenCalled();

      // Switch session and close the side reader while its chunk is in flight.
      await act(async () => root.render(renderReaders("current", false)));
      await act(async () => {
        gate.resolve();
        await gate.promise;
        await vi.dynamicImportSettled();
      });
      expect(
        host.querySelector('[data-testid="chat-loading-block"]')
      ).toBeNull();
      expect(host.querySelectorAll("[data-reader]")).toHaveLength(1);
      expect(host.querySelector('[data-reader="current"]')?.textContent).toBe(
        "compact"
      );
      expect(mount).toHaveBeenCalledTimes(1);

      await act(async () => root.render(renderReaders("next", true)));
      expect(host.querySelectorAll('[data-reader="next"]')).toHaveLength(2);
      expect(mount).toHaveBeenCalledTimes(2);
      expect(unmount).not.toHaveBeenCalled();
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
    expect(unmount).toHaveBeenCalledTimes(2);
  });

  it("propagates a chunk failure to the owning error boundary", async () => {
    vi.resetModules();
    const failure = new Error("chat history chunk unavailable");
    vi.doMock("./ChatHistory", () => {
      throw failure;
    });
    const { default: ChatHistory } = await import("./index");
    const caught = vi.fn();
    class ErrorBoundary extends React.Component<
      { children: React.ReactNode },
      { failed: boolean }
    > {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: unknown) {
        caught(error);
      }
      render() {
        return this.state.failed ? "reader unavailable" : this.props.children;
      }
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(ErrorBoundary, null, createElement(ChatHistory))
        );
      });
      await act(async () => vi.dynamicImportSettled());
      expect(host.textContent).toBe("reader unavailable");
      expect(caught).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
