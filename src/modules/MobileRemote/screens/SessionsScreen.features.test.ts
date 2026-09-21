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

import {
  type MobileReadStateSync,
  createMobileReadStateSync,
} from "../app/mobileReadStateSync";
import type { MobilePendingInbox } from "../app/useMobilePendingInbox";
import type {
  MobileRpcClient,
  RpcNotificationHandler,
} from "../connection/mobileRpcClient";
import type {
  MobileConnectionState,
  MobileSessionRow,
} from "../connection/types";
import { SessionsScreen } from "./SessionsScreen";

const state = vi.hoisted(() => ({
  connection: {} as MobileConnectionState,
  sessions: [] as MobileSessionRow[],
  pendingInbox: {} as MobilePendingInbox,
  rpc: null,
  sessionsHasMore: false,
  rosterPhase: "ready",
  refreshSessions: vi.fn(),
  loadMoreSessions: vi.fn(),
  focusPermission: vi.fn(),
  readStateSync: undefined as MobileReadStateSync | undefined,
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
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key} ${options.name}` : key,
    i18n: { language: "en" },
  }),
}));

describe("SessionsScreen feature transitions", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let select: Mock<(sessionId: string) => void>;
  const button = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((element) =>
      element.textContent?.includes(text)
    )!;
  const render = () =>
    act(async () =>
      root.render(
        React.createElement(SessionsScreen, { onSelectSession: select })
      )
    );
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    select = vi.fn<(sessionId: string) => void>();
    state.connection = {
      status: "connected",
      presence: "online",
      desktopId: "one",
      desktopName: "Work Mac",
      demoMode: false,
      capabilities: { pendingInteractions: true, sessionSearch: true },
    };
    state.sessions = [
      {
        id: "session-a",
        name: "Session A",
        status: "idle",
        repoName: "Workspace A",
      },
    ];
    state.pendingInbox = {
      phase: "syncing",
      complete: false,
      items: [],
      refresh: vi.fn(),
    };
    state.rosterPhase = "ready";
    state.refreshSessions.mockReset().mockResolvedValue(undefined);
    state.focusPermission.mockClear();
    state.readStateSync = undefined;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    state.readStateSync?.dispose();
    host.remove();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("distinguishes online loading, empty, failure and retained rows with retry", async () => {
    state.sessions = [];
    state.rosterPhase = "loading";
    await render();
    expect(host.textContent).toContain("sessions.loading");
    expect(host.textContent).not.toContain("sessions.empty");
    state.rosterPhase = "ready";
    await render();
    expect(host.textContent).toContain("sessions.empty");
    state.rosterPhase = "error";
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "sessions.loadFailed"
    );
    await act(async () => button("sessions.retry").click());
    expect(state.refreshSessions).toHaveBeenCalledTimes(1);
    state.sessions = [{ id: "retained", name: "Retained", status: "idle" }];
    await render();
    expect(host.textContent).toContain("sessions.refreshFailed");
    expect(host.textContent).toContain("Retained");
    state.rosterPhase = "loading";
    await render();
    expect(host.textContent).toContain("sessions.refreshing");
    expect(button("sessions.retry")).toBeUndefined();
    state.rosterPhase = "ready";
    await render();
    expect(host.textContent).not.toContain("sessions.refreshing");
    expect(host.textContent).not.toContain("sessions.empty");
  });

  it("shows unknown rather than zero before the global snapshot is complete", async () => {
    await render();
    expect(button("inbox.title").textContent).toContain("inbox.syncing");
    expect(button("inbox.title").textContent).not.toMatch(/·\s*0/);
    expect(
      host.querySelector(
        '[data-testid="mobile-remote-session-row"] [aria-label="sessions.state.unknown"]'
      )
    ).not.toBeNull();
    state.pendingInbox = {
      ...state.pendingInbox,
      phase: "ready",
      complete: true,
    };
    await render();
    // The compact inbox entry disappears only after a complete, empty snapshot.
    expect(button("inbox.title")).toBeUndefined();
    expect(
      host.querySelector(
        '[data-testid="mobile-remote-session-row"] [aria-label="sessions.state.idle"]'
      )
    ).not.toBeNull();
  });
  it("updates the rendered unread dot from push without refreshing the roster or waking a hidden list", async () => {
    let notify!: RpcNotificationHandler;
    let visited = false;
    const call = vi.fn(async () => ({
      visitedIds: visited ? ["session-a"] : [],
    }));
    const client = {
      call,
      onNotification: (fn: RpcNotificationHandler) => {
        notify = fn;
        return () => undefined;
      },
    } as unknown as MobileRpcClient;
    state.readStateSync = createMobileReadStateSync();
    state.readStateSync.connect(client, "desktop");
    state.sessions[0].lifecycleStatus = "completed";
    await render();
    expect(
      host.querySelector('[aria-label="sessions.state.unread"]')
    ).not.toBeNull();
    await act(async () => {
      visited = true;
      notify("session/read_state_changed", {});
    });
    expect(
      host.querySelector('[aria-label="sessions.state.unread"]')
    ).toBeNull();
    expect(call.mock.calls).toHaveLength(2);
    await act(async () =>
      root.render(React.createElement(SessionsScreen, { active: false }))
    );
    await act(async () => notify("session/read_state_changed", {}));
    expect(call.mock.calls).toHaveLength(2);
  });

  it("shows canonical waiting state while the permissions inbox is syncing, then offline on disconnect", async () => {
    state.sessions[0].lifecycleStatus = "waiting_for_user";
    await render();
    expect(
      host.querySelector('[data-session-status="waiting_for_user"]')
    ).not.toBeNull();
    state.connection.presence = "offline";
    await render();
    expect(
      host.querySelector('[data-session-status="offline"]')
    ).not.toBeNull();
    expect(
      host.querySelector('[data-session-status="waiting_for_user"]')
    ).toBeNull();
    state.connection.presence = "online";
    state.sessions[0].lifecycleStatus = "completed";
    await render();
    expect(
      host.querySelector('[data-session-status="completed"]')
    ).not.toBeNull();
  });

  it("derives approval state from the global inbox and retains a flat list with workspace metadata", async () => {
    state.pendingInbox = {
      ...state.pendingInbox,
      phase: "ready",
      complete: true,
      items: [
        {
          kind: "permission",
          origin: "rust_agent",
          sessionId: "session-a",
          requestId: "request-a",
          toolName: "shell",
          toolArgs: { command: "pwd" },
          createdAtMs: 1000,
        },
      ],
    };
    await render();
    const row = host.querySelector(
      '[data-testid="mobile-remote-session-row"]'
    )!;
    expect(
      row.querySelector('[aria-label="sessions.state.awaiting_approval"]')
    ).not.toBeNull();
    expect(row.textContent).toContain("Workspace A");
    expect(host.querySelector('[aria-label="sessions.groupBy"]')).toBeNull();
    state.pendingInbox = { ...state.pendingInbox, items: [] };
    await render();
    expect(
      row.querySelector('[aria-label="sessions.state.idle"]')
    ).not.toBeNull();
  });

  it("keeps pending items readable offline but disables navigation and explains reconnect", async () => {
    state.pendingInbox = {
      ...state.pendingInbox,
      phase: "ready",
      complete: true,
      items: [
        {
          kind: "permission",
          origin: "rust_agent",
          sessionId: "session-a",
          requestId: "request-a",
          toolName: "shell",
          toolArgs: { command: "pwd" },
          createdAtMs: 1000,
        },
      ],
    };
    await render();
    await act(async () => button("inbox.title").click());
    expect(button("inbox.open").disabled).toBe(false);
    await act(async () => button("inbox.open").click());
    expect(select).toHaveBeenCalledWith("session-a");
    expect(state.focusPermission).toHaveBeenCalledWith("request-a");
    select.mockClear();
    state.connection = { ...state.connection, presence: "offline" };
    await render();
    expect(host.textContent).toContain("inbox.offline");
    expect(button("inbox.open").disabled).toBe(true);
    await act(async () => button("inbox.open").click());
    expect(select).not.toHaveBeenCalled();
    expect(host.textContent).toContain("pwd");
  });

  it("returns focus to the remounted inbox entry after cancelling the pending list", async () => {
    await render();
    await act(async () => button("inbox.title").click());
    await act(async () => button("inbox.backToSessions").click());
    expect(document.activeElement).toBe(button("inbox.title"));
  });

  it("keeps one page heading and returns to the original search trigger on Escape", async () => {
    await render();
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="search.title"]'
    )!;
    await act(async () => trigger.click());
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("tabs.sessions");
    expect(host.querySelector("h2")).toBeNull();
    await act(async () =>
      host
        .querySelector("section")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        )
    );
    expect(host.querySelector("h1")?.textContent).toBe("tabs.sessions");
    expect(document.activeElement).toBe(
      host.querySelector('[aria-label="search.title"]')
    );
  });

  it("search makes computer scope explicit and cancel preserves the original list node and scroll", async () => {
    await render();
    const row = host.querySelector(
      '[data-testid="mobile-remote-session-row"]'
    )!;
    const list = row.closest<HTMLDivElement>(".mobile-discovery-scroll")!;
    list.scrollTop = 320;
    const searchButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="search.title"]'
    )!;
    await act(async () => searchButton.click());
    expect(host.textContent).not.toContain("search.scope");
    expect(list.hidden).toBe(false);
    await act(async () => button("search.cancel").click());
    expect(
      host.querySelector('[data-testid="mobile-remote-session-row"]')
    ).toBe(row);
    expect(list.hidden).toBe(false);
    expect(list.scrollTop).toBe(320);
    expect(document.activeElement).toBe(
      host.querySelector('[aria-label="search.title"]')
    );
  });

  it("explains unsupported server search instead of sending a legacy unfiltered request", async () => {
    state.connection = { ...state.connection, capabilities: {} };
    await render();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="search.title"]')!
        .click()
    );
    expect(host.textContent).toContain("search.unsupported");
    expect(host.querySelector(".mobile-search-scope")).toBeNull();
    expect(host.querySelector("form")).toBeNull();
    await act(async () => button("search.cancel").click());
    expect(host.querySelector('[aria-label="search.title"]')).not.toBeNull();
    expect(host.textContent).not.toContain("search.unsupported");
  });
});
