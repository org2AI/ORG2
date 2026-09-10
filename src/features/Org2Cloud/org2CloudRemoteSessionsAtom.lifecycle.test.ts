// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { org2CloudAuthAtom } from "./org2CloudAuthAtom";
import {
  bumpRemoteSessionsInvalidation,
  fetchCloudOrgRemoteSessions,
  org2CloudRemoteSessionsAtom,
  org2CloudRemoteSessionsVersionAtom,
  useCloudOrgRemoteSessions,
} from "./org2CloudRemoteSessionsAtom";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./org2CloudClient", () => ({
  ensureFreshSession: async (auth: unknown) => auth,
}));
vi.mock("./org2CloudSyncClient", () => ({ listOrgSessions: mocks.list }));
vi.mock("./org2CloudAuthAtom", async () => {
  const { atom } = await import("jotai");
  return {
    org2CloudAuthAtom: atom({
      userId: "user",
      supabaseUrl: "https://test.invalid",
      accessToken: "test",
    }),
    org2CloudAuthIdentityKey: (auth: { supabaseUrl: string; userId: string }) =>
      `${auth.supabaseUrl}|${auth.userId}`,
    commitRefreshedAuth: () => true,
  };
});

const root = createSmokeRoot();
afterEach(async () => {
  await root.unmount();
  vi.restoreAllMocks();
  mocks.list.mockReset();
});

it("loads an initially hidden listing when visible without requiring keyboard focus", async () => {
  let visibility: DocumentVisibilityState = "hidden";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  mocks.list.mockResolvedValue({ sessions: [] });
  const store = createStore();
  expect(store.get(org2CloudAuthAtom)).not.toBeNull();
  function Listing() {
    const { state } = useCloudOrgRemoteSessions("org");
    return createElement("div", null, state);
  }
  await root.render(createElement(Provider, { store }, createElement(Listing)));
  expect(mocks.list).not.toHaveBeenCalled();

  await act(async () => {
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(root.container.textContent).toBe("ready");

  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(mocks.list).toHaveBeenCalledTimes(1);

  await act(async () => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    store.set(org2CloudRemoteSessionsVersionAtom, (previous) =>
      bumpRemoteSessionsInvalidation(previous, "org")
    );
  });
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => {
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("shares explicit continuation demand with the hidden sidebar without starting a poll", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  let finish!: (value: { sessions: [] }) => void;
  mocks.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const store = createStore();
  function Listing() {
    const { state } = useCloudOrgRemoteSessions("org");
    return createElement("div", null, state);
  }
  await root.render(createElement(Provider, { store }, createElement(Listing)));
  expect(mocks.list).not.toHaveBeenCalled();

  let request!: Promise<void>;
  await act(async () => {
    request = fetchCloudOrgRemoteSessions(store, "org", { full: true });
    expect(fetchCloudOrgRemoteSessions(store, "org", { full: true })).toBe(
      request
    );
    await Promise.resolve();
  });
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(root.container.textContent).toBe("loading");
  await act(async () => {
    finish({ sessions: [] });
    await request;
  });
  expect(root.container.textContent).toBe("ready");
  expect(mocks.list).toHaveBeenCalledTimes(1);
});

it("does not publish an explicit request after the account changes", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  let finish!: (value: { sessions: [] }) => void;
  mocks.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const store = createStore();
  function Listing() {
    const { state } = useCloudOrgRemoteSessions("org");
    return createElement("div", null, state);
  }
  await root.render(createElement(Provider, { store }, createElement(Listing)));
  let request!: Promise<void>;
  await act(async () => {
    request = fetchCloudOrgRemoteSessions(store, "org");
    await Promise.resolve();
  });
  await act(async () => {
    store.set(org2CloudAuthAtom, {
      ...store.get(org2CloudAuthAtom)!,
      userId: "other",
    });
  });
  await act(async () => {
    finish({ sessions: [] });
    await request;
  });
  expect(store.get(org2CloudRemoteSessionsAtom)).toEqual({});
  expect(root.container.textContent).toBe("idle");
});

it("releases failed explicit requests so the existing action retry can recover", async () => {
  const store = createStore();
  mocks.list.mockRejectedValueOnce(new Error("offline"));
  await fetchCloudOrgRemoteSessions(store, "org", { full: true });
  expect(store.get(org2CloudRemoteSessionsAtom).org.state).toBe("error");
  mocks.list.mockResolvedValueOnce({ sessions: [] });
  await fetchCloudOrgRemoteSessions(store, "org", { full: true });
  expect(store.get(org2CloudRemoteSessionsAtom).org.state).toBe("ready");
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
