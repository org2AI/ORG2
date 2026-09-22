// @vitest-environment jsdom
import { Provider, createStore, useAtomValue } from "jotai";
import { act, createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  beginOrg2CloudOrgsRequest,
  commitOrg2CloudOrgsRequest,
  org2CloudOrgsAtom,
  org2CloudOrgsLoadedAtom,
  sidebarActiveCloudOrgIdAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { sidebarSelectedOrgIdAtom } from "@src/features/Organizations/sidebarOrgScopeAtom";
import { type Session } from "@src/store/session";
import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useSidebarOrgScope } from "./useSidebarOrgScope";

vi.mock("@src/api/http/project", () => ({
  projectApi: { readOrgs: vi.fn(async () => []) },
}));
vi.mock("@src/hooks/project", () => ({ useProjectDataChanged: vi.fn() }));
vi.mock("@src/features/TeamCollaboration/repoScopeResolver", () => ({
  useShareableScopeKeyVersion: () => 0,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const AUTH = {
  kind: "org2_cloud" as const,
  userId: "viewer",
  supabaseUrl: "https://cloud.example.test",
  accessToken: "access",
  refreshToken: "refresh",
  supabaseAnonKey: "anon",
  expiresAt: 9999999999,
};
const ORGS = [
  { orgId: "a", name: "A", role: "member" },
  { orgId: "b", name: "B", role: "member" },
];
const SESSIONS: Session[] = [];

let scope: ReturnType<typeof useSidebarOrgScope>;
function Sidebar(): null {
  const currentScope = useSidebarOrgScope({ sortedSessions: SESSIONS });
  useEffect(() => {
    scope = currentScope;
  }, [currentScope]);
  return null;
}
function Consumer() {
  return createElement(
    "output",
    null,
    useAtomValue(sidebarActiveCloudOrgIdAtom) ?? "personal"
  );
}
function App({ sidebar, hover }: { sidebar: boolean; hover: boolean }) {
  return createElement(
    "main",
    null,
    createElement(Consumer),
    sidebar ? createElement(Sidebar, { key: "docked" }) : null,
    hover ? createElement(Sidebar, { key: "hover" }) : null
  );
}

describe("application cloud scope survives sidebar lifecycle", () => {
  let root: SmokeRoot;
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    localStorage.clear();
    store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    store.set(sidebarSelectedOrgIdAtom, "cloud:a");
    commitOrg2CloudOrgsRequest(store, beginOrg2CloudOrgsRequest(store), ORGS);
    root = createSmokeRoot();
  });
  afterEach(async () => {
    await root.unmount();
    localStorage.clear();
  });

  async function render(sidebar: boolean, hover: boolean) {
    await root.render(
      createElement(Provider, { store }, createElement(App, { sidebar, hover }))
    );
  }

  it("keeps scope after hover closes, settings replaces both views, and remount", async () => {
    await render(true, false);
    await render(true, true);
    await render(true, false);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
    await render(false, false);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
    await act(async () => {
      store.set(sidebarSelectedOrgIdAtom, "cloud:b");
    });
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("b");
    await render(true, false);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("b");
  });

  it("reacts to revoked membership and local selection without mounted sidebars", async () => {
    await render(false, false);
    await act(async () => {
      commitOrg2CloudOrgsRequest(store, beginOrg2CloudOrgsRequest(store), [
        ORGS[1],
      ]);
    });
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBeNull();
    expect(store.get(sidebarSelectedOrgIdAtom)).toBe("cloud:a");
    await act(async () => {
      store.set(sidebarSelectedOrgIdAtom, "cloud:b");
    });
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("b");
    await act(async () => {
      store.set(sidebarSelectedOrgIdAtom, "local-org");
    });
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBeNull();
  });

  it.each([
    { ...AUTH, userId: "another-user" },
    { ...AUTH, supabaseUrl: "https://another.example.test" },
    null,
  ])(
    "invalidates old account membership synchronously before owner effects",
    (nextAuth) => {
      const oldRequest = beginOrg2CloudOrgsRequest(store);
      store.set(org2CloudAuthAtom, nextAuth);
      expect(store.get(sidebarActiveCloudOrgIdAtom)).toBeNull();
      expect(commitOrg2CloudOrgsRequest(store, oldRequest, ORGS)).toBe(false);
      expect(store.get(org2CloudOrgsAtom)).toEqual(ORGS);
      if (nextAuth) {
        commitOrg2CloudOrgsRequest(
          store,
          beginOrg2CloudOrgsRequest(store),
          ORGS
        );
        expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
      }
    }
  );

  it("keeps pending selection without granting scope, then preserves confirmed scope during refresh", () => {
    store.set(org2CloudOrgsLoadedAtom, false);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBeNull();
    expect(store.get(sidebarSelectedOrgIdAtom)).toBe("cloud:a");
    commitOrg2CloudOrgsRequest(store, beginOrg2CloudOrgsRequest(store), ORGS);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
    // A same-identity refresh (or its failure with no commit) is not a scope change.
    beginOrg2CloudOrgsRequest(store);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
  });

  it("evicts removed-org filters and preserves the remaining org's preference", async () => {
    await render(true, false);
    await act(async () => {
      scope.handleCloudSessionFilterChange({
        kind: "member",
        ownerUserId: "a-user",
      });
    });
    await act(async () => {
      store.set(sidebarSelectedOrgIdAtom, "cloud:b");
    });
    await act(async () => {
      scope.handleCloudSessionFilterChange({ kind: "directlySharedWithMe" });
    });
    await act(async () => {
      commitOrg2CloudOrgsRequest(store, beginOrg2CloudOrgsRequest(store), [
        ORGS[1],
      ]);
    });
    expect(scope.cloudSessionFilter).toEqual({ kind: "directlySharedWithMe" });
    await act(async () => {
      commitOrg2CloudOrgsRequest(store, beginOrg2CloudOrgsRequest(store), ORGS);
      store.set(sidebarSelectedOrgIdAtom, "cloud:a");
    });
    expect(scope.cloudSessionFilter).toEqual({ kind: "all" });
  });

  it("drops retained member filters when the account changes even for the same org", async () => {
    await render(true, false);
    await act(async () => {
      scope.handleCloudSessionFilterChange({
        kind: "member",
        ownerUserId: "old-user",
      });
    });
    const oldChangeFilter = scope.handleCloudSessionFilterChange;
    await act(async () => {
      store.set(org2CloudAuthAtom, { ...AUTH, userId: "next-user" });
      commitOrg2CloudOrgsRequest(store, beginOrg2CloudOrgsRequest(store), ORGS);
    });
    expect(scope.cloudSessionFilter).toEqual({ kind: "all" });
    await act(async () => {
      scope.handleCloudSessionFilterChange({ kind: "directlySharedWithMe" });
    });
    await act(async () => {
      oldChangeFilter({ kind: "member", ownerUserId: "stale" });
    });
    expect(scope.cloudSessionFilter).toEqual({ kind: "directlySharedWithMe" });
  });

  it("rejects an old auth callback even when it starts after account switch", () => {
    store.set(org2CloudAuthAtom, { ...AUTH, userId: "next-user" });
    const currentRequest = beginOrg2CloudOrgsRequest(store);
    const request = beginOrg2CloudOrgsRequest(
      store,
      "https://cloud.example.test|viewer"
    );
    expect(commitOrg2CloudOrgsRequest(store, request, ORGS)).toBe(false);
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBeNull();
    expect(commitOrg2CloudOrgsRequest(store, currentRequest, ORGS)).toBe(true);
  });

  it("retains membership across token refresh and isolated store teardown", async () => {
    const otherStore = createStore();
    store.set(org2CloudAuthAtom, { ...AUTH, accessToken: "refreshed" });
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
    expect(otherStore.get(sidebarActiveCloudOrgIdAtom)).toBeNull();
    await render(true, true);
    await root.unmount();
    expect(store.get(sidebarActiveCloudOrgIdAtom)).toBe("a");
  });
});
