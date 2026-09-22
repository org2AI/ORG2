// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobilePendingInbox } from "../app/useMobilePendingInbox";
import type {
  MobileConnectionState,
  MobilePairedDesktopSummary,
  MobileSessionRow,
} from "../connection/types";
import { SessionsScreen } from "./SessionsScreen";

const state = vi.hoisted(() => ({
  connection: {} as MobileConnectionState,
  sessions: [] as MobileSessionRow[],
  pairedDesktops: [] as MobilePairedDesktopSummary[],
  switchPairedDesktop: vi.fn(),
  pendingInbox: undefined as MobilePendingInbox | undefined,
  sessionsHasMore: false,
  loadMoreSessions: vi.fn(),
  rpc: null,
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
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("SessionsScreen redesigned navigation", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const select = vi.fn();
  const render = (active = true) =>
    act(async () =>
      root.render(
        React.createElement(SessionsScreen, {
          active,
          onSelectSession: select,
          profileAction: React.createElement(
            "button",
            { "aria-label": "Account" },
            "A"
          ),
        })
      )
    );
  const click = (element: HTMLElement) => act(async () => element.click());
  const tabs = () =>
    Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        "[data-testid=mobile-session-device-tab]"
      )
    );

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.connection = {
      status: "connected",
      presence: "online",
      demoMode: false,
      desktopId: "mac",
      desktopName: "MacBook Pro · Alice",
      capabilities: { sessionSearch: true },
    };
    state.sessions = [
      {
        id: "today",
        name: "Today session",
        status: "idle",
        repoName: "Workspace A",
        updatedAtMs: Date.now(),
      },
      {
        id: "older",
        name: "Older session",
        status: "idle",
        repoName: "Workspace B",
        updatedAtMs: new Date(2020, 0, 1).getTime(),
      },
      {
        id: "unknown",
        name: "Unknown date",
        status: "idle",
        repoName: "Workspace C",
      },
    ];
    state.pairedDesktops = [
      { id: "mac", name: "MacBook Pro · Alice", active: true, updatedAtMs: 1 },
      { id: "studio", name: "Mac Studio · Bob", active: false, updatedAtMs: 2 },
    ];
    state.pendingInbox = undefined;
    state.switchPairedDesktop.mockReset();
    select.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the account left, options menu right, and search outside the header", async () => {
    await render();
    const header = host.querySelector("header")!;
    expect(
      header.querySelector(
        ".mobile-top-bar__trailing [aria-label='sessions.viewOptions']"
      )
    ).not.toBeNull();
    expect(
      header.querySelector(".mobile-top-bar__leading [aria-label='Account']")
    ).not.toBeNull();
    expect(header.querySelectorAll("h1")).toHaveLength(1);
    expect(header.querySelector("[aria-label='search.title']")).toBeNull();
    const search = host.querySelector<HTMLButtonElement>(
      "[aria-label='search.title']"
    )!;
    expect(search.closest(".mobile-discovery-search--launcher")).not.toBeNull();
    const searchIcon = search.querySelector(".mobile-search-icon")!;
    const searchLabel = Array.from(search.children).find(
      (element) => element.textContent === "search.title"
    )!;
    expect(searchLabel).toBeDefined();
    expect(searchLabel.contains(searchIcon)).toBe(false);
    expect(searchIcon.parentElement?.parentElement).toBe(search);
    expect(search.style.borderRadius).toBe("var(--mobile-search-radius)");
    await click(search);
    expect(
      host.querySelector(".mobile-discovery-search form[role=search] input")
    ).not.toBeNull();
    expect(host.querySelector("header input")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("groups canonical sessions by time through the dropdown and returns to the unchanged flat order", async () => {
    await render();
    const menu = () =>
      host.querySelector<HTMLButtonElement>(
        "[aria-label='sessions.viewOptions']"
      )!;
    const option = (mode: string) =>
      document.querySelector<HTMLElement>(
        `[data-testid=mobile-group-${mode}]`
      )!;
    const original = state.sessions.slice();
    await click(menu());
    await click(option("time"));
    expect(host.textContent).toContain("sessions.groupToday");
    expect(host.textContent).toContain("sessions.groupEarlier");
    expect(host.textContent).toContain("sessions.groupUnknown");
    expect(host.textContent).toContain("Workspace A");
    const rows = host.querySelectorAll<HTMLButtonElement>(
      "[data-testid=mobile-remote-session-row]"
    );
    await click(rows[1]);
    expect(select).toHaveBeenCalledWith("older");
    await click(menu());
    await click(option("none"));
    expect(
      host.querySelector(".mobile-discovery-section-label")?.textContent
    ).toBe("sessions.all");
    expect(
      Array.from(
        host.querySelectorAll(".mobile-session-row__title"),
        (node) => node.textContent
      )
    ).toEqual(original.map((row) => row.name));
    expect(state.sessions).toEqual(original);
  });

  it("groups by workspace, incorporates arriving rows, and preserves the selection through search cancel", async () => {
    state.sessions[2].repoName = "Workspace A";
    await render();
    const menu = () =>
      host.querySelector<HTMLButtonElement>(
        "[aria-label='sessions.viewOptions']"
      )!;
    const headings = () =>
      Array.from(
        host.querySelectorAll(".mobile-discovery-section-label"),
        (node) => node.textContent
      );
    await click(menu());
    await click(
      document.querySelector<HTMLElement>(
        "[data-testid=mobile-group-workspace]"
      )!
    );
    expect(headings()).toEqual(["Workspace A", "Workspace B"]);
    expect(
      host.querySelectorAll(".mobile-session-row__workspace")
    ).toHaveLength(0);
    expect(host.querySelectorAll(".mobile-session-row__time")).toHaveLength(0);
    expect(host.querySelectorAll(".mobile-session-row--compact")).toHaveLength(
      3
    );
    expect(host.querySelectorAll(".mobile-session-row__meta")).toHaveLength(0);
    expect(host.querySelectorAll("[data-session-status]")).toHaveLength(3);
    expect(state.sessions[0].repoName).toBe("Workspace A");
    expect(
      Array.from(
        host.querySelectorAll(".mobile-session-row__title"),
        (node) => node.textContent
      )
    ).toEqual(["Today session", "Unknown date", "Older session"]);
    state.sessions = [
      ...state.sessions,
      { id: "new", name: "New session", status: "idle" },
    ];
    await render();
    expect(headings()).toEqual([
      "Workspace A",
      "Workspace B",
      "sessions.groupNoWorkspace",
    ]);
    await click(
      host.querySelector<HTMLButtonElement>("[aria-label='search.title']")!
    );
    const cancel = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "search.cancel"
    )!;
    await click(cancel);
    expect(headings()).toEqual([
      "Workspace A",
      "Workspace B",
      "sessions.groupNoWorkspace",
    ]);
    await click(menu());
    await click(
      document.querySelector<HTMLElement>("[data-testid=mobile-group-none]")!
    );
    expect(headings()).toEqual(["sessions.all"]);
    expect(host.querySelectorAll(".mobile-session-row__time")).toHaveLength(2);
    expect(host.querySelectorAll(".mobile-session-row--compact")).toHaveLength(
      0
    );
    expect(
      host.querySelectorAll(".mobile-session-row__workspace")
    ).toHaveLength(3);
    expect(
      Array.from(
        host.querySelectorAll(".mobile-session-row__title"),
        (node) => node.textContent
      )
    ).toEqual(state.sessions.map((row) => row.name));
  });

  it("locks a pending device switch, reports failure, and retries without optimistic device selection", async () => {
    let reject!: (reason: Error) => void;
    state.switchPairedDesktop.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    );
    await render();
    await click(tabs()[0]);
    expect(state.switchPairedDesktop).not.toHaveBeenCalled();
    await act(async () => {
      tabs()[1].click();
      tabs()[1].click();
    });
    expect(state.switchPairedDesktop).toHaveBeenCalledTimes(1);
    expect(state.switchPairedDesktop).toHaveBeenCalledWith("studio");
    expect(tabs().every((tab) => tab.disabled)).toBe(true);
    expect(tabs()[0].dataset.active).toBe("true");
    await act(async () => reject(new Error("offline")));
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "devices.switchFailed"
    );
    expect(tabs().every((tab) => !tab.disabled)).toBe(true);
    state.switchPairedDesktop.mockResolvedValueOnce(undefined);
    await click(tabs()[1]);
    expect(state.switchPairedDesktop).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[role=alert]")).toBeNull();
    state.pairedDesktops = state.pairedDesktops.map((desktop) => ({
      ...desktop,
      active: desktop.id === "studio",
    }));
    state.connection = {
      ...state.connection,
      desktopId: "studio",
      desktopName: "Mac Studio · Bob",
    };
    await render();
    expect(tabs()[1].dataset.active).toBe("true");
  });

  it("shows a single offline/reconnect notice while preserving loaded workspace labels", async () => {
    state.connection = {
      ...state.connection,
      status: "connecting",
      presence: "offline",
    };
    await render();
    expect(
      host.querySelectorAll(".mobile-discovery-notice[role=status]")
    ).toHaveLength(1);
    expect(host.querySelector(".mobile-discovery-notice")?.textContent).toBe(
      "connection.reconnecting"
    );
    expect(host.textContent).toContain("Workspace A");
    expect(
      host.querySelectorAll("[data-testid=mobile-remote-session-row]")
    ).toHaveLength(3);
    state.connection = {
      ...state.connection,
      status: "connected",
      presence: "online",
    };
    await render();
    expect(host.querySelector(".mobile-discovery-notice")).toBeNull();
    await render(false);
    expect(host.innerHTML).toBe("");
  });
});
