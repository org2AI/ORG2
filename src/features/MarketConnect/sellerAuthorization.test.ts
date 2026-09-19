// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";
import { connectSellerAccount } from "./sellerAuthorization";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn() }));
vi.mock("@src/api/tauri/rpc/invoke", async (original) => ({
  ...(await original<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: mocks.invoke,
}));
vi.mock("./auth", () => ({
  withFreshMarketOwner: (work: () => Promise<unknown>) => work(),
}));
const proof = {
  provider: "claude",
  region: "sjc",
  state: "s".repeat(43),
  challenge: "c".repeat(43),
};
const result = { binding_id: "cb_test", auth_id: "claude_test" };
let store: ReturnType<typeof signedInStore>;
const approval = () => ({
  code: "a".repeat(43),
  state: proof.state,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
});
const commands = () => mocks.invoke.mock.calls.map(([p]) => p.command);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), oauthClientId: USER_A });
  mocks.invoke.mockImplementation(async (p: { command: string }) =>
    p.command === "market_seller_begin"
      ? proof
      : p.command === "market_seller_complete"
        ? result
        : undefined
  );
  mocks.fetch.mockImplementation(
    async () => new Response(JSON.stringify(approval()))
  );
});
afterEach(() => vi.unstubAllGlobals());
it("authorizes from the current App identity without opening a website", async () => {
  expect(
    await connectSellerAccount("claude", new AbortController().signal, store)
  ).toEqual(result);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  const [url, request] = mocks.fetch.mock.calls[0];
  expect(url).toBe(
    "https://market.org2.dev/api/auth/native/seller/authorize-desktop"
  );
  expect(request).toMatchObject({
    credentials: "omit",
    redirect: "error",
    headers: { authorization: "Bearer test" },
  });
  expect(JSON.parse(request.body)).toEqual(proof);
  expect(
    mocks.invoke.mock.calls.find(
      ([p]) => p.command === "market_seller_complete"
    )?.[1]
  ).toEqual({
    code: "a".repeat(43),
    state: proof.state,
    expectedIdentityUserId: USER_A,
  });
  expect(commands()).not.toContain("market_seller_cancel");
});
it("does not allow another request to race the same local receiver", async () => {
  let finish!: () => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = () => resolve(new Response(JSON.stringify(approval())));
      })
  );
  const first = connectSellerAccount(
    "claude",
    new AbortController().signal,
    store
  );
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  await expect(
    connectSellerAccount("codex", new AbortController().signal, store)
  ).rejects.toThrow("seller_connection_in_progress");
  finish();
  await first;
});
it("cancels native proof if the account changes while desktop authorization is pending", async () => {
  mocks.fetch.mockImplementation(async () => {
    store.set(org2CloudAuthAtom, { ...authFor(USER_B), oauthClientId: USER_A });
    return new Response(JSON.stringify(approval()));
  });
  await expect(
    connectSellerAccount("claude", new AbortController().signal, store)
  ).rejects.toThrow("market_identity_mismatch");
  expect(commands()).toContain("market_seller_cancel");
  expect(commands()).not.toContain("market_seller_complete");
});
it("cancels a proof when unmounted during native begin", async () => {
  const controller = new AbortController();
  mocks.invoke.mockImplementation(async (p: { command: string }) => {
    if (p.command === "market_seller_begin") {
      controller.abort();
      return proof;
    }
  });
  await expect(
    connectSellerAccount("claude", controller.signal, store)
  ).rejects.toThrow("seller_connection_cancelled");
  expect(commands()).toContain("market_seller_cancel");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("rejects mismatched, expired, oversized or credential-bearing approvals", async () => {
  for (const body of [
    { ...approval(), state: "x".repeat(43) },
    { ...approval(), expires_at: new Date(Date.now() - 1000).toISOString() },
    { ...approval(), token: "must-not-pass" },
    { ...approval(), extra: "x".repeat(5000) },
  ]) {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(
      connectSellerAccount("claude", new AbortController().signal, store)
    ).rejects.toThrow("invalid_seller_authorization");
  }
  expect(commands()).not.toContain("market_seller_complete");
  expect(commands().filter((c) => c === "market_seller_cancel")).toHaveLength(
    4
  );
});
it("requires a desktop OAuth login before creating native work", async () => {
  store.set(org2CloudAuthAtom, authFor());
  await expect(
    connectSellerAccount("claude", new AbortController().signal, store)
  ).rejects.toThrow("market_reauthorization_required");
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("preserves the requested region and refuses a substituted native proof", async () => {
  mocks.invoke.mockImplementation(async (p: { command: string }) =>
    p.command === "market_seller_begin"
      ? { ...proof, region: "fra" }
      : p.command === "market_seller_complete"
        ? result
        : undefined
  );
  await connectSellerAccount(
    "claude",
    new AbortController().signal,
    store,
    "fra"
  );
  expect(
    mocks.invoke.mock.calls.find(
      ([p]) => p.command === "market_seller_begin"
    )?.[1]
  ).toEqual({ provider: "claude", region: "fra" });
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).region).toBe("fra");
  await expect(
    connectSellerAccount("claude", new AbortController().signal, store, "sjc")
  ).rejects.toThrow("invalid_seller_authorization");
  expect(
    commands().filter((command) => command === "market_seller_complete")
  ).toHaveLength(1);
});
