// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createSessionSourcesTab } from "@src/store/workstation/tabs/factories/sessionSources";

import SessionSourcesTabRenderer from "./sessionSources";

const api = vi.hoisted(() => ({ readSessionSourceMessages: vi.fn() }));
const navigation = vi.hoisted(() => ({
  openSource: vi.fn(),
  closeImagePreview: vi.fn(),
  imagePreview: null,
}));
vi.mock("@src/api/tauri/session/sessionSources", () => api);
vi.mock("@src/features/SessionSources/useSessionSourceNavigation", () => ({
  useSessionSourceNavigation: () => navigation,
}));
vi.mock(
  "@src/engines/ChatPanel/sessionSources/SessionSourcesFileScope",
  () => ({
    SessionSourcesFileScope: ({ children }: { children: React.ReactNode }) =>
      children,
  })
);
const session = atom({ updated_at: "initial" });
vi.mock("@src/store/session", () => ({ sessionByIdAtom: () => session }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      `${key}${options?.count === undefined ? "" : ` ${options.count}`}`,
  }),
}));

function terminalMessage(callId: string, error: string) {
  return {
    id: callId,
    role: "tool",
    text: "",
    images: [],
    toolActivity: {
      callId,
      toolName: "mcp__codex_app__read_thread_terminal",
      group: "codex-app",
      status: "error",
      error,
      actions: [{ kind: "read-terminal" }],
    },
  };
}

let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createStore>;
async function render(sessionId: string) {
  await act(async () => {
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(SessionSourcesTabRenderer, {
          tab: createSessionSourcesTab(sessionId, "Sources"),
          isActive: true,
        })
      )
    );
  });
}
function button(key: string) {
  const found = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(key)
  );
  expect(found, key).toBeDefined();
  return found!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  store = createStore();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("renders failed tool activity without a resource and resets disclosures on session switch", async () => {
  api.readSessionSourceMessages.mockResolvedValueOnce([
    terminalMessage(
      "a",
      "No app terminal session is attached to this thread yet."
    ),
  ]);
  await render("session-a");
  expect(host.textContent).toContain("toolGroupCodexApp");
  expect(host.textContent).not.toContain("noSources");
  expect(button("toolTerminalCount").getAttribute("aria-expanded")).toBe(
    "false"
  );
  act(() => button("toolTerminalCount").click());
  expect(host.textContent).toContain("No app terminal session is attached");

  api.readSessionSourceMessages.mockResolvedValueOnce([
    terminalMessage("b", "Different session error"),
  ]);
  await render("session-b");
  expect(button("toolTerminalCount").getAttribute("aria-expanded")).toBe(
    "false"
  );
  expect(host.textContent).not.toContain("No app terminal session is attached");
  expect(host.textContent).not.toContain("Different session error");
  act(() => button("toolTerminalCount").click());
  expect(host.textContent).toContain("Different session error");
});

it("keeps operation counts stable on refresh and opens a web action through source navigation", async () => {
  const activity = {
    id: "web-message",
    role: "tool",
    text: "",
    toolActivity: {
      callId: "web-call",
      toolName: "web.run",
      group: "web",
      status: "success",
      actions: [
        { kind: "search", query: "first query" },
        { kind: "search", query: "second query" },
        { kind: "open", url: "https://example.com/docs" },
      ],
    },
  };
  api.readSessionSourceMessages.mockResolvedValue([activity, activity]);
  await render("session-web");
  expect(button("toolSearchCount").textContent).toContain("2");
  expect(button("toolOpenCount").textContent).toContain("1");
  act(() => button("toolSearchCount").click());
  expect(host.textContent).toContain("first query");
  expect(host.textContent).toContain("second query");
  act(() => button("toolOpenCount").click());
  await act(async () => button("https://example.com/docs").click());
  expect(navigation.openSource).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "link", url: "https://example.com/docs" })
  );
  await act(async () => store.set(session, { updated_at: "refreshed" }));
  expect(button("toolSearchCount").textContent).toContain("2");
  expect(button("toolSearchCount").getAttribute("aria-expanded")).toBe("true");
});

it("aggregates identical real calls after ingestion without losing counts or distinct failures", async () => {
  const messages = Array.from({ length: 49 }, (_, index) => ({
    id: `message-${index}`,
    role: "tool",
    text: "",
    toolActivity: {
      callId: `call-${index}`,
      toolName: "mcp__cua_repl.js",
      group: "mcp:cua_repl",
      status: index < 46 ? "success" : "error",
      ...(index >= 46
        ? { error: index < 48 ? "Element unavailable" : "Tab closed" }
        : {}),
      actions: [{ kind: "generic" }],
    },
  }));
  api.readSessionSourceMessages.mockResolvedValue([...messages, messages[0]]);
  await render("session-repeated-tools");
  expect(button("toolCallCount").textContent).toContain("49");
  act(() => button("toolCallCount").click());
  expect(host.querySelectorAll("[data-tool-activity-call]")).toHaveLength(3);
  expect(host.textContent).toContain("toolRepeatCount 46");
  expect(host.textContent).toContain("toolRepeatCount 2");
  expect(host.textContent).toContain("Element unavailable");
  expect(host.textContent).toContain("Tab closed");
  await act(async () => store.set(session, { updated_at: "refresh-repeats" }));
  expect(button("toolCallCount").textContent).toContain("49");
  expect(host.querySelectorAll("[data-tool-activity-call]")).toHaveLength(3);
});
