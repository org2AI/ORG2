// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SessionHoverCard from "./index";
import { dismissHoverCard } from "./singletonStore";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loaded: vi.fn(),
  contentMounted: vi.fn(),
  contentUnmounted: vi.fn(),
}));

vi.mock("./loadSessionHoverCardContent", () => ({
  loadSessionHoverCardContent: mocks.load,
  getLoadedSessionHoverCardContent: mocks.loaded,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "actions.loading" ? "Loading..." : "Failed to load",
  }),
}));

function Content({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    mocks.contentMounted(sessionId);
    return () => mocks.contentUnmounted(sessionId);
  }, [sessionId]);
  return createElement("div", { "data-testid": "session-detail" }, sessionId);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SessionHoverCard deferred content", () => {
  let container: HTMLDivElement;
  let root: Root;
  let pending: ReturnType<typeof deferred<typeof Content>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    pending = deferred<typeof Content>();
    mocks.loaded.mockReturnValue(null);
    mocks.load.mockImplementation(() => pending.promise);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          "div",
          null,
          ...["first", "second"].map((sessionId) =>
            jsx(
              SessionHoverCard,
              {
                sessionId,
                children: createElement("button", { id: sessionId }, sessionId),
              },
              sessionId
            )
          )
        )
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    dismissHoverCard();
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function hover(id = "first") {
    act(() => {
      container.querySelector(`#${id}`)!.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        })
      );
    });
  }

  function leave(id = "first") {
    act(() => {
      container.querySelector(`#${id}`)!.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        })
      );
    });
  }

  function advance(ms: number) {
    act(() => vi.advanceTimersByTime(ms));
  }

  it("does not load before the existing hover delay and cancels a brief hover", async () => {
    expect(mocks.load).not.toHaveBeenCalled();
    hover();
    advance(499);
    expect(mocks.load).not.toHaveBeenCalled();
    leave();
    advance(1000);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.contentMounted).not.toHaveBeenCalled();

    hover();
    advance(500);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Loading..."
    );
    expect(mocks.contentMounted).not.toHaveBeenCalled();

    await act(async () => pending.resolve(Content));
    expect(
      document.querySelector('[data-testid="session-detail"]')?.textContent
    ).toBe("first");
    expect(mocks.contentMounted).toHaveBeenCalledTimes(1);
    expect(mocks.contentMounted).toHaveBeenCalledWith("first");
  });

  it("ignores completion after close and mounts only when reopened", async () => {
    hover();
    advance(500);
    leave();
    advance(100);
    expect(document.querySelector("[data-hover-card]")).toBeNull();
    await act(async () => pending.resolve(Content));
    expect(mocks.contentMounted).not.toHaveBeenCalled();
    mocks.loaded.mockReturnValue(Content);

    hover();
    advance(500);
    expect(document.querySelectorAll("[data-hover-card]")).toHaveLength(1);
    expect(mocks.contentMounted).toHaveBeenCalledTimes(1);
    expect(mocks.contentMounted).toHaveBeenCalledWith("first");
    leave();
    advance(100);
    expect(mocks.contentUnmounted).toHaveBeenCalledTimes(1);
    expect(mocks.contentUnmounted).toHaveBeenCalledWith("first");
  });

  it("renders only the new portal owner if hover changes while the chunk loads", async () => {
    hover();
    advance(500);
    hover("second");
    advance(500);
    expect(document.querySelectorAll("[data-hover-card]")).toHaveLength(1);
    await act(async () => pending.resolve(Content));
    expect(mocks.contentMounted).toHaveBeenCalledTimes(1);
    expect(mocks.contentMounted).toHaveBeenCalledWith("second");
    expect(
      document.querySelector('[data-testid="session-detail"]')?.textContent
    ).toBe("second");
  });

  it("contains chunk failures in the card and retries on the next hover", async () => {
    hover();
    advance(500);
    await act(async () => pending.reject(new Error("chunk unavailable")));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Failed to load"
    );
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(mocks.contentMounted).not.toHaveBeenCalled();
    leave();
    advance(100);

    pending = deferred<typeof Content>();
    hover();
    advance(500);
    await act(async () => pending.resolve(Content));
    expect(mocks.contentMounted).toHaveBeenCalledTimes(1);
    expect(mocks.contentMounted).toHaveBeenCalledWith("first");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
