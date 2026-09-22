// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { MobileConnectionState } from "../connection/types";
import { SessionsScreen } from "./SessionsScreen";

const state = vi.hoisted(() => ({
  connection: {} as MobileConnectionState,
  rpc: null as MobileRpcClient | null,
  sessions: [{ id: "recent", name: "Recent session", status: "idle" }],
  sessionsHasMore: false,
  loadMoreSessions: vi.fn(),
}));
vi.mock("../app", () => ({ useMobileRemote: () => state }));
vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  const { createBrowserMobileRemotePlatform } =
    await import("../platform/browser");
  const platform = createBrowserMobileRemotePlatform();
  return { ...actual, useMobileRemotePlatform: () => platform };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { query?: string; name?: string }) =>
      `${key}${values?.query ? ` ${values.query}` : ""}${values?.name ? ` ${values.name}` : ""}`,
    i18n: { language: "en" },
  }),
}));

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const page = (name: string, nextOffset = 50, hasMore = false) => ({
  sessions: [
    { id: name, name, status: "idle", repoName: "Project", updatedAtMs: 1000 },
  ],
  nextOffset,
  hasMore,
});

describe("SessionsScreen search recovery", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let call: ReturnType<typeof vi.fn>;
  let select: Mock<(sessionId: string) => void>;
  const render = (active = true) =>
    act(async () =>
      root.render(
        React.createElement(SessionsScreen, { onSelectSession: select, active })
      )
    );
  const button = (key: string) =>
    Array.from(host.querySelectorAll("button")).find(
      (node) => node.textContent === key
    )!;
  const openSearch = () =>
    act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="search.title"]')!
        .click()
    );
  const typeQuery = (value: string) =>
    act(async () => {
      const input = host.querySelector("input")!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const submit = () =>
    act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
    });
  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    call = vi.fn();
    select = vi.fn<(sessionId: string) => void>();
    state.rpc = { call } as unknown as MobileRpcClient;
    state.connection = {
      status: "connected",
      presence: "online",
      demoMode: false,
      desktopName: "Work Mac",
      capabilities: { sessionSearch: true },
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps workspace labels on search results even when the main list is grouped by workspace", async () => {
    call.mockResolvedValueOnce(page("Historic session"));
    await render();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          "[aria-label='sessions.viewOptions']"
        )!
        .click()
    );
    await act(async () =>
      document
        .querySelector<HTMLElement>("[data-testid=mobile-group-workspace]")!
        .click()
    );
    await openSearch();
    await typeQuery("Historic");
    await act(async () => vi.advanceTimersByTime(200));
    const row = Array.from(
      host.querySelectorAll("[data-testid=mobile-remote-session-row]")
    ).find((node) => node.textContent?.includes("Historic session"))!;
    expect(
      row.querySelector(".mobile-session-row__workspace")?.textContent
    ).toBe("Project");
    await act(async () => button("search.cancel").click());
    expect(
      host.querySelector(".mobile-discovery-section-label")?.textContent
    ).toBe("sessions.groupNoWorkspace");
  });

  it("debounces typing in place, shows progress, retries and opens historical results", async () => {
    const first = deferred();
    call
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page("Historic session"));
    await render();
    await openSearch();
    await typeQuery("orig");
    await act(async () => vi.advanceTimersByTime(150));
    await typeQuery("original");
    await act(async () => vi.advanceTimersByTime(199));
    expect(call).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain("search.loading");
    expect(button("search.submit")).toBeUndefined();
    expect(host.querySelector("h1")?.textContent).toBe("tabs.sessions");
    await act(async () => first.reject(new Error("timeout")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "search.error"
    );
    await act(async () => button("search.retry").click());
    expect(call).toHaveBeenLastCalledWith(
      "session/list",
      {
        query: "original",
        offset: 0,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
    expect(host.textContent).toContain("search.resultsFor original");
    expect(host.querySelector("input")?.value).toBe("original");
    const row = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="mobile-remote-session-row"]'
      )
    ).find((node) => node.textContent?.includes("Historic session"))!;
    expect(row.textContent).toContain("Project");
    expect(row.querySelector("time")).not.toBeNull();
    await act(async () => row.click());
    expect(select).toHaveBeenCalledWith("Historic session");
  });

  it("retries the failed next page without restarting or losing the last successful page", async () => {
    call
      .mockResolvedValueOnce(page("First page", 125, true))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page("Next page", 200));
    await render();
    await openSearch();
    await typeQuery("project");
    await submit();
    await act(async () => button("search.next").click());
    expect(host.textContent).toContain("First page");
    expect(button("search.next")).toBeUndefined();
    await act(async () => button("search.retry").click());
    expect(call).toHaveBeenLastCalledWith(
      "session/list",
      {
        query: "project",
        offset: 125,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
    expect(host.textContent).toContain("Next page");
    expect(host.textContent).not.toContain("First page");
  });

  it("clearing the input cancels loading and never displays its late result", async () => {
    const request = deferred();
    call.mockReturnValue(request.promise);
    await render();
    await openSearch();
    await typeQuery("old");
    await submit();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="search.clear"]')!
        .click()
    );
    expect(document.activeElement).toBe(host.querySelector("input"));
    expect(host.textContent).not.toContain("search.loading");
    expect(
      host
        .querySelector('[data-testid="mobile-remote-session-row"]')
        ?.closest("[hidden]")
    ).toBeNull();
    await act(async () => request.resolve(page("Stale result")));
    expect(host.textContent).not.toContain("Stale result");
    expect(host.textContent).not.toContain("search.resultsFor");
  });

  it("disconnect ends loading, disables retry and recovers explicitly when online", async () => {
    const request = deferred();
    call
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce({ sessions: [], nextOffset: 0, hasMore: false });
    await render();
    await openSearch();
    await typeQuery("query");
    await submit();
    state.connection = { ...state.connection, presence: "offline" };
    await render();
    expect(host.textContent).not.toContain("search.loading");
    expect(host.textContent).toContain("search.offline");
    expect(button("search.retry").disabled).toBe(true);
    state.connection = { ...state.connection, presence: "online" };
    await render();
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => button("search.retry").click());
    await act(async () => request.resolve(page("Old connection")));
    expect(host.textContent).toContain("search.empty");
    expect(host.textContent).not.toContain("Old connection");
  });

  it("cancel during a request restores the original list and a new query ignores the cancelled result", async () => {
    const request = deferred();
    call
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce(page("Fresh result"));
    await render();
    const list = host
      .querySelector('[data-testid="mobile-remote-session-row"]')!
      .closest<HTMLDivElement>(".mobile-discovery-scroll")!;
    list.scrollTop = 200;
    await openSearch();
    await typeQuery("cancelled");
    await submit();
    // Browsers may report zero scrollTop while display:none. Keep the visible offset.
    list.scrollTop = 0;
    await act(async () => list.dispatchEvent(new Event("scroll")));
    await act(async () => button("search.cancel").click());
    expect(list.hidden).toBe(false);
    expect(list.scrollTop).toBe(200);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "search.title"
    );
    await openSearch();
    await typeQuery("fresh");
    await submit();
    await act(async () => request.resolve(page("Cancelled result")));
    expect(host.textContent).toContain("Fresh result");
    expect(host.textContent).not.toContain("Cancelled result");
  });

  it("debounces edits and releases an aborted RPC without waiting for its reply", async () => {
    const old = deferred();
    call
      .mockImplementationOnce(
        (_method, _params, signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
            void old.promise.then(resolve, reject);
          })
      )
      .mockResolvedValueOnce(page("Latest"));
    await render();
    await openSearch();
    await typeQuery("old");
    await act(async () => vi.advanceTimersByTime(200));
    await typeQuery("middle");
    await act(async () => vi.advanceTimersByTime(100));
    await typeQuery("latest");
    await act(async () => vi.advanceTimersByTime(200));
    expect(call).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Latest");
    await act(async () => old.resolve(page("Stale")));
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith(
      "session/list",
      {
        query: "latest",
        offset: 0,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
    expect(host.textContent).toContain("Latest");
    expect(host.textContent).not.toContain("Stale");
  });

  it("waits for Chinese composition and Enter flushes only once", async () => {
    call.mockResolvedValue(page("中文结果"));
    await render();
    await openSearch();
    await act(async () =>
      host
        .querySelector("input")!
        .dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true })
        )
    );
    await typeQuery("中文");
    await act(async () =>
      host.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        })
      )
    );
    expect(host.querySelector("input")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(500));
    await submit();
    expect(call).not.toHaveBeenCalled();
    await act(async () =>
      host
        .querySelector("input")!
        .dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true })
        )
    );
    await submit();
    await act(async () => vi.advanceTimersByTime(500));
    expect(call).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("中文结果");
  });

  it("cancels queued debounce on cancel, inactivity, visibility loss and unmount", async () => {
    call.mockResolvedValue(page("Result"));
    await render();
    await openSearch();
    await typeQuery("cancel");
    await act(async () => button("search.cancel").click());
    await act(async () => vi.advanceTimersByTime(300));
    expect(call).not.toHaveBeenCalled();
    await openSearch();
    await typeQuery("hidden");
    await render(false);
    await act(async () => vi.advanceTimersByTime(300));
    expect(call).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
    await render();
    const visibility = vi
      .spyOn(document, "hidden", "get")
      .mockReturnValue(true);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    await act(async () => vi.advanceTimersByTime(300));
    expect(call).not.toHaveBeenCalled();
    visibility.mockReturnValue(false);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTime(300));
    expect(call).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it("retains the query, result page and both scroll positions while inactive", async () => {
    call.mockResolvedValue(page("Historic"));
    await render();
    const all = host.querySelector(".mobile-discovery-scroll")!;
    all.scrollTop = 120;
    await act(async () => all.dispatchEvent(new Event("scroll")));
    await openSearch();
    await typeQuery("history");
    await act(async () => vi.advanceTimersByTime(200));
    const results = host.querySelector(".mobile-discovery-scroll")!;
    results.scrollTop = 220;
    await act(async () => results.dispatchEvent(new Event("scroll")));
    await render(false);
    await act(async () => vi.advanceTimersByTime(1000));
    await render();
    expect(host.querySelector("input")?.value).toBe("history");
    expect(host.textContent).toContain("Historic");
    expect(host.querySelector(".mobile-discovery-scroll")?.scrollTop).toBe(220);
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => button("search.cancel").click());
    expect(host.querySelector(".mobile-discovery-scroll")?.scrollTop).toBe(120);
  });
});
