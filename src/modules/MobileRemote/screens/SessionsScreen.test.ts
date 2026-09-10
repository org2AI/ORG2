// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SessionsScreen } from "./SessionsScreen";

const state = vi.hoisted(() => ({
  connection: { desktopId: "one", desktopName: "Mac", presence: "online" },
  sessions: [
    { id: "codexapp-a", name: "Session A", status: "idle", repoPath: "/repo" },
  ],
  sessionsHasMore: false,
  loadMoreSessions: vi.fn(),
}));
vi.mock("../app", () => ({ useMobileRemote: () => state }));
vi.mock("../platform", () => ({
  useMobileRemotePlatform: () => ({
    runtime: {
      readPreference: (key: string) => localStorage.getItem(key),
      writePreference: (key: string, value: string) =>
        localStorage.setItem(key, value),
    },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SessionsScreen", () => {
  it("shows a flat list despite saved grouping and forwards the original session ID", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem(
      'org2.remote.session-groups.v1:["demo","demo","one"]',
      JSON.stringify({ mode: "workspace", collapsed: ["workspace:/repo"] })
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const select = vi.fn();
    await act(() =>
      root.render(
        React.createElement(SessionsScreen, { onSelectSession: select })
      )
    );
    expect(host.querySelector('[aria-label="sessions.groupBy"]')).toBeNull();
    expect(host.querySelector("[aria-expanded]")).toBeNull();
    expect(host.textContent).toContain("Session A");
    await act(() =>
      host
        .querySelector<HTMLButtonElement>(
          "[data-testid=mobile-remote-session-row]"
        )!
        .click()
    );
    expect(select).toHaveBeenCalledWith("codexapp-a");
    state.sessionsHasMore = true;
    state.loadMoreSessions.mockRejectedValueOnce(new Error("offline"));
    await act(() => root.render(React.createElement(SessionsScreen)));
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("sessions.loadMore"))!
        .click();
    });
    expect(host.textContent).toContain("sessions.retry");
    state.loadMoreSessions.mockResolvedValueOnce(undefined);
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("sessions.retry"))!
        .click();
    });
    expect(state.loadMoreSessions).toHaveBeenCalledTimes(2);
    await act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });
});
