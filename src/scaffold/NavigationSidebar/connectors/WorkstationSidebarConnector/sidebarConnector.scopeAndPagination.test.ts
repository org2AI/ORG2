import { webcrypto } from "node:crypto";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCloudEndpoint } from "@src/features/Org2Cloud/config";
import { org2CloudOAuth } from "@src/features/Org2Cloud/org2CloudOAuth";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

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

beforeEach(() => {
  createInstrumentedStore();
  const endpoint = getCloudEndpoint();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        version: 1,
        clientId: "desktop-client",
        authorizationEndpoint: `${endpoint.supabaseUrl}/auth/v1/oauth/authorize`,
        tokenEndpoint: `${endpoint.supabaseUrl}/auth/v1/oauth/token`,
        userEndpoint: `${endpoint.supabaseUrl}/auth/v1/oauth/userinfo`,
        redirectUri: `${endpoint.webOrigin}/auth/desktop/oauth/callback`,
        scopes: ["email", "profile"],
      })
    )
  );
});

afterEach(() => {
  org2CloudOAuth.cancel();
  resetInstrumentedStore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sidebar cloud sign-in", () => {
  it("starts a receiver only on click and returns login to this app instance", async () => {
    let signIn: (() => Promise<boolean>) | undefined;
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

    expect(await signIn!()).toBe(true);

    await vi.waitFor(() => expect(mocks.openUrl).toHaveBeenCalledTimes(1));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    const login = new URL(mocks.openUrl.mock.calls[0][0]);
    expect(login.pathname).toBe("/auth/v1/oauth/authorize");
    expect(login.searchParams.get("state")).toMatch(
      /^org2v1\.49152\.[A-Za-z0-9_-]{43}$/
    );
    expect(login.searchParams.get("response_type")).toBe("code");
    expect(login.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    );
    expect(login.searchParams.has("code_verifier")).toBe(false);
    org2CloudOAuth.cancel();
    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(49152));
  });
});
