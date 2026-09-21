import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";
import { handleMarketOwnerRefresh } from "./ownerRefresh";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  ready: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: mocks.invoke,
}));
vi.mock("@src/api/http/auth/sharedAuthStorage", async (original) => ({
  ...(await original<typeof import("@src/api/http/auth/sharedAuthStorage")>()),
  awaitNativeCloudOwnerReady: mocks.ready,
}));
const TICKET = "11111111-2222-4333-8444-555555555555";
const response = () =>
  new Response(
    JSON.stringify({
      access_token: "rotated",
      refresh_token: "new-refresh",
      expires_at: Date.now() / 1000 + 3600,
    }),
    { status: 200 }
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.ready.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command) =>
    command === "market_connection_refresh_claim" ? USER_A : null
  );
});
afterEach(() => vi.unstubAllGlobals());

it("refreshes expired canonical auth while hidden and sends only an opaque ticket over IPC", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  vi.stubGlobal("document", { visibilityState: "hidden" });
  mocks.fetch.mockResolvedValue(response());
  await handleMarketOwnerRefresh(TICKET, store);
  expect(store.get(org2CloudAuthAtom)?.refreshToken).toBe("new-refresh");
  expect(mocks.ready).toHaveBeenCalledOnce();
  expect(mocks.invoke.mock.calls).toEqual([
    ["market_connection_refresh_claim", { ticket: TICKET }],
    ["market_connection_refresh_complete", { ticket: TICKET }],
  ]);
});
it("ignores malformed, spoofed and already claimed tickets without refreshing auth", async () => {
  const store = signedInStore();
  mocks.invoke.mockResolvedValue(null);
  await handleMarketOwnerRefresh({ ticket: TICKET }, store);
  await handleMarketOwnerRefresh("invalid", store);
  expect(mocks.invoke).not.toHaveBeenCalled();
  await handleMarketOwnerRefresh(TICKET, store);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledOnce();
});
it("cannot refresh another account nominated by a stale event", async () => {
  const store = signedInStore();
  mocks.invoke.mockResolvedValueOnce(USER_B);
  await expect(handleMarketOwnerRefresh(TICKET, store)).rejects.toThrow(
    "market_identity_mismatch"
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "market_connection_refresh_complete",
    { ticket: TICKET }
  );
});
it("does not restore A after A→B→A during the refresh and still wakes native verification", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  let resolve!: (response: Response) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  const pending = handleMarketOwnerRefresh(TICKET, store);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  store.set(org2CloudAuthAtom, authFor(USER_B));
  store.set(org2CloudAuthAtom, authFor());
  resolve(response());
  await rejected;
  expect(store.get(org2CloudAuthAtom)?.accessToken).not.toBe("rotated");
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "market_connection_refresh_complete",
    { ticket: TICKET }
  );
});
it("wakes native after transport failure without claiming a successful owner", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockRejectedValue(new Error("offline"));
  await expect(handleMarketOwnerRefresh(TICKET, store)).rejects.toThrow(
    "market_cloud_verification_unavailable"
  );
  expect(store.get(org2CloudAuthAtom)?.expiresAt).toBe(0);
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "market_connection_refresh_complete",
    { ticket: TICKET }
  );
});

it("disposes a timed-out owner's subscription and keeps repeated tickets bounded until canonical work settles", async () => {
  vi.useFakeTimers();
  const store = signedInStore();
  const originalSub = store.sub.bind(store);
  let subscriptions = 0;
  const subscribe = vi.spyOn(store, "sub").mockImplementation((...args) => {
    subscriptions++;
    const unsubscribe = originalSub(...args);
    return () => {
      subscriptions--;
      unsubscribe();
    };
  });
  let finish!: () => void;
  mocks.ready.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finish = done;
      })
  );
  try {
    const first = handleMarketOwnerRefresh(TICKET, store);
    const failed = expect(first).rejects.toThrow(
      "market_cloud_refresh_unavailable"
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptions).toBe(1);
    expect(mocks.ready).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(subscriptions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // Native may create another request after its deadline; JS must not attach
    // any further subscriptions or promise waiters to the blocked refresh.
    for (let i = 0; i < 10; i++) await handleMarketOwnerRefresh(TICKET, store);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(mocks.ready).toHaveBeenCalledOnce();
    expect(subscriptions).toBe(0);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    await handleMarketOwnerRefresh(TICKET, store);
    expect(mocks.ready).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscriptions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    subscribe.mockRestore();
    vi.useRealTimers();
  }
});

it("an aborted bridge releases its guard immediately and never executes late work", async () => {
  const { withFreshMarketOwner } = await import("./auth");
  const store = signedInStore();
  const work = vi.fn(async () => "authorized");
  let finish!: () => void;
  mocks.ready.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finish = done;
      })
  );
  const controller = new AbortController();
  const pending = withFreshMarketOwner(work, USER_A, store, controller.signal);
  const rejected = expect(pending).rejects.toThrow(
    "market_cloud_refresh_unavailable"
  );
  await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce());
  controller.abort();
  store.set(org2CloudAuthAtom, authFor(USER_B));
  store.set(org2CloudAuthAtom, authFor());
  finish();
  await rejected;
  expect(work).not.toHaveBeenCalled();
});
