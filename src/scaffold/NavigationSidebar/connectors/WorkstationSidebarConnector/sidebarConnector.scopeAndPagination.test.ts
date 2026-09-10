import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { completePendingOrg2CloudAuthLoopback } from "@src/features/Org2Cloud/org2CloudAuthLoopback";

import { useWorkstationSidebarScopeAndPagination } from "./sidebarConnector.scopeAndPagination";

const mocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(49152),
  cancel: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@fabianlars/tauri-plugin-oauth", () => mocks);
vi.mock("@tauri-apps/plugin-opener", () => mocks);
vi.mock("./sidebarSessionRefresh", () => ({
  useSidebarSessionRefreshEffects: vi.fn(),
}));
vi.mock("./sidebarMenuCollections", () => ({
  useChatPanelTuiSidebarSessions: () => [],
}));
vi.mock("./useSidebarOrgScope", () => ({
  useSidebarOrgScope: () => ({}),
}));
vi.mock("@src/store/repo", async () => {
  const { atom } = await import("jotai");
  return { repoMapAtom: atom({}) };
});
vi.mock("../workstationSidebarData", () => ({
  buildRepoPathToName: () => new Map(),
  sortSessionsByActivity: (sessions: unknown[]) => sessions,
}));

afterEach(() => {
  completePendingOrg2CloudAuthLoopback(sessionStorage);
  vi.clearAllMocks();
});

describe("sidebar cloud sign-in", () => {
  it("starts a receiver only on click and returns login to this app instance", async () => {
    let signIn: (() => void) | undefined;
    function Harness() {
      // Expose the real handler from this one-shot server-render test harness.
      // eslint-disable-next-line react-hooks/globals
      signIn = useWorkstationSidebarScopeAndPagination({
        sessions: [],
      }).handleCloudSignIn;
      return null;
    }
    renderToString(createElement(Harness));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();

    signIn!();

    await vi.waitFor(() => expect(mocks.openUrl).toHaveBeenCalledTimes(1));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    const login = new URL(mocks.openUrl.mock.calls[0][0]);
    const callback = new URL(login.searchParams.get("return_to")!);
    expect(callback.origin).toBe("http://localhost:49152");
    expect(callback.pathname).toBe("/org2-cloud/auth/callback");
    expect(callback.searchParams.get("state")).toBeTruthy();
  });
});
