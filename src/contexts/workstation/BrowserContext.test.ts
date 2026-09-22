// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BrowserProvider, useBrowserContext } from "./BrowserContext";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function SessionCreator() {
  const browser = useBrowserContext();
  return createElement(
    "button",
    {
      onClick: () => browser.handleAddSession("https://example.com"),
    },
    "Open"
  );
}

it("keeps private sessions live but persists and restores only normal sessions", async () => {
  let browser!: ReturnType<typeof useBrowserContext>;
  function Capture() {
    const current = useBrowserContext();
    useEffect(() => {
      browser = current;
    }, [current]);
    return null;
  }
  const container = document.createElement("div");
  let root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(BrowserProvider, null, createElement(Capture)))
    );
    await act(async () => {
      browser.handleAddSession("https://normal.example");
    });
    const normalId = browser.activeSessionId;
    await act(async () => {
      browser.handleAddSession("https://private.example/secret", true);
    });
    const privateId = browser.activeSessionId;
    await act(async () => {
      browser.updateSession(privateId, {
        history: [
          "https://private.example/first",
          "https://private.example/secret",
        ],
      });
    });
    browser.forceSave();
    expect(browser.sessions).toHaveLength(2);
    expect(browser.activeSessionId).toBe(privateId);
    const saved = JSON.parse(
      localStorage.getItem("browser-explorer-sessions")!
    );
    expect(saved.sessions.map((session: { id: string }) => session.id)).toEqual(
      [normalId]
    );
    expect(saved.activeSessionId).toBe(normalId);
    expect(JSON.stringify(saved)).not.toContain("private.example");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(createElement(BrowserProvider, null, createElement(Capture)))
    );
    expect(browser.sessions.map((session) => session.id)).toEqual([normalId]);
    expect(browser.activeSessionId).toBe(normalId);
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not hydrate historical private tabs or persist a private-only window", async () => {
  localStorage.setItem(
    "browser-explorer-sessions",
    JSON.stringify({
      sessions: [
        {
          id: "private-old",
          incognito: true,
          url: "https://private.example/old",
          history: [],
        },
      ],
      activeSessionId: "private-old",
    })
  );
  let browser!: ReturnType<typeof useBrowserContext>;
  function Capture() {
    const current = useBrowserContext();
    useEffect(() => {
      browser = current;
    }, [current]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(createElement(BrowserProvider, null, createElement(Capture)))
    );
    expect(browser.sessions).toEqual([]);
    expect(localStorage.getItem("browser-explorer-sessions")).toBeNull();
    await act(async () => {
      browser.handleAddSession("https://private.example/new", true);
    });
    browser.forceSave();
    expect(browser.sessions).toHaveLength(1);
    expect(localStorage.getItem("browser-explorer-sessions")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("creates and persists new sessions without timestamped browsing history", async () => {
  const persist = vi.spyOn(Storage.prototype, "setItem");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(BrowserProvider, null, createElement(SessionCreator))
      )
    );
    await act(async () => container.querySelector("button")?.click());
    const saved = JSON.parse(
      localStorage.getItem("browser-explorer-sessions") ?? "null"
    );
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0]).not.toHaveProperty("historyEntries");
    expect(saved.sessions[0].history).toEqual(["https://example.com"]);
    expect(saved.sessions[0].historyIndex).toBe(0);
  } finally {
    await act(async () => root.unmount());
    const keys = persist.mock.calls.map(([key]) => key);
    persist.mockRestore();
    expect(keys).not.toContain("orgii-global-tabs");
  }
});

it("does not migrate away existing stored history entries", async () => {
  const oldEntries = [
    { url: "https://old.example", title: "Old", visitedAt: 1 },
  ];
  localStorage.setItem(
    "browser-explorer-sessions",
    JSON.stringify({
      sessions: [
        {
          id: "old",
          url: "https://old.example",
          title: "Old",
          history: ["https://old.example"],
          historyIndex: 0,
          historyEntries: oldEntries,
          isLoading: false,
          error: null,
        },
      ],
      activeSessionId: "old",
    })
  );
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        createElement(BrowserProvider, null, createElement(SessionCreator))
      )
    );
    const saved = JSON.parse(
      localStorage.getItem("browser-explorer-sessions") ?? "null"
    );
    expect(saved.sessions[0].historyEntries).toEqual(oldEntries);
  } finally {
    await act(async () => root.unmount());
  }
});
