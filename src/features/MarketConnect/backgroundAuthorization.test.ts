import { atom } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";

import { ORG2_CLOUD_OFFICIAL_SUPABASE_URL } from "@src/features/Org2Cloud/config";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { authorizeMarketInBackground } from "./backgroundAuthorization";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@src/features/Org2Cloud/org2CloudAuthAction", () => ({
  refreshOrg2CloudAuthForAction: mocks.refresh,
}));
vi.mock("@src/features/Org2Cloud/org2CloudAuthAtom", () => ({
  org2CloudAuthAtom: atom<unknown>(null),
}));
const auth = {
  userId: "user-a",
  supabaseUrl: ORG2_CLOUD_OFFICIAL_SUPABASE_URL,
  accessToken: "synthetic-access-token",
  oauthClientId: "desktop-client",
};
const state = "s".repeat(43);
const code = "c".repeat(43);
const challenge = "p".repeat(43);
const response = () => ({
  code,
  state,
  expires_at: new Date(Date.now() + 80_000).toISOString(),
});
const options = () => ({
  authorization: new URL(
    `https://market.org2.dev/buyer/connect/authorize?workspace_id=ws_test&target=org2&state=${state}&challenge=${challenge}`
  ),
  selection: new URL("orgii://market/connect?workspace_id=ws_test&target=org2"),
  auth: auth as never,
  complete: vi.fn(async (_raw: string, _isCurrent: () => boolean) => {}),
  cancel: vi.fn(async () => {}),
});
beforeEach(() => {
  vi.clearAllMocks();
  createInstrumentedStore().set(org2CloudAuthAtom, auth as never);
  mocks.refresh.mockResolvedValue({ status: "ready", auth });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(response()))
  );
});
it("posts only public proof with bearer auth and redeems locally without exposing the bearer", async () => {
  const o = options();
  await authorizeMarketInBackground(o);
  expect(fetch).toHaveBeenCalledWith(
    "https://market.org2.dev/api/auth/native/authorize-desktop",
    expect.objectContaining({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        workspace_id: "ws_test",
        target: "org2",
        state,
        challenge,
      }),
    })
  );
  expect(o.complete).toHaveBeenCalledWith(
    `orgii://market/authorized?code=${code}&state=${state}`,
    expect.any(Function)
  );
  expect(JSON.stringify(o.complete.mock.calls)).not.toContain(auth.accessToken);
  expect(o.cancel).not.toHaveBeenCalled();
  createInstrumentedStore().set(org2CloudAuthAtom, null);
  expect(o.cancel).not.toHaveBeenCalled(); // attempt subscription was disposed
});
it.each([
  "https://evil.example/buyer/connect/authorize",
  "http://market.org2.dev/buyer/connect/authorize",
  `https://market.org2.dev/buyer/connect/authorize?workspace_id=ws_other&target=org2&state=${state}&challenge=${challenge}`,
  `https://market.org2.dev/buyer/connect/authorize?workspace_id=ws_test&target=codex&state=${state}&challenge=${challenge}`,
  `https://market.org2.dev/buyer/connect/authorize?workspace_id=ws_test&target=org2&state=${state}&state=${state}&challenge=${challenge}`,
])(
  "rejects an untrusted or differently scoped proof before network access: %s",
  async (url) => {
    const o = { ...options(), authorization: new URL(url) };
    await expect(authorizeMarketInBackground(o)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(o.complete).not.toHaveBeenCalled();
    expect(o.cancel).toHaveBeenCalledOnce();
  }
);
it.each(["state", "expired", "long-lived", "extra-secret", "oversized"])(
  "rejects %s authorization responses without redeeming",
  async (kind) => {
    const value: Record<string, unknown> = response();
    if (kind === "state") value.state = "x".repeat(43);
    if (kind === "expired")
      value.expires_at = new Date(Date.now() - 1000).toISOString();
    if (kind === "long-lived")
      value.expires_at = new Date(Date.now() + 180_000).toISOString();
    if (kind === "extra-secret") value.access_token = "must-never-be-accepted";
    if (kind === "oversized") value.code = "c".repeat(5000);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(value));
    const o = options();
    await expect(authorizeMarketInBackground(o)).rejects.toThrow(
      "invalid_market_authorization_response"
    );
    expect(o.complete).not.toHaveBeenCalled();
    expect(o.cancel).toHaveBeenCalledOnce();
  }
);
it.each([404, 405, 503, 401])(
  "fails closed on HTTP %s instead of a browser fallback",
  async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("private server detail", { status })
    );
    const o = options();
    await expect(authorizeMarketInBackground(o)).rejects.toThrow(
      "market_request_failed"
    );
    expect(o.complete).not.toHaveBeenCalled();
    expect(o.cancel).toHaveBeenCalledOnce();
  }
);
it.each([
  null,
  { ...auth, userId: "other-user" },
  { ...auth, supabaseUrl: "https://other.example" },
])(
  "cancels and rejects late responses after identity invalidation",
  async (next) => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const o = options();
    const attempt = authorizeMarketInBackground(o);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    createInstrumentedStore().set(org2CloudAuthAtom, next as never);
    createInstrumentedStore().set(org2CloudAuthAtom, auth as never); // switching back must not resurrect the attempt
    finish(Response.json(response()));
    await expect(attempt).rejects.toThrow("market_identity_mismatch");
    expect(o.complete).not.toHaveBeenCalled();
    expect(o.cancel).toHaveBeenCalledOnce();
  }
);
it("cancels during Rust redemption and marks the completion as stale", async () => {
  const o = options();
  o.complete.mockImplementationOnce(async (_raw, isCurrent) => {
    createInstrumentedStore().set(org2CloudAuthAtom, null);
    expect(isCurrent()).toBe(false);
  });
  await expect(authorizeMarketInBackground(o)).rejects.toThrow(
    "market_identity_mismatch"
  );
  expect(o.cancel).toHaveBeenCalledOnce();
});
it.each(["expired", "unavailable", "superseded"])(
  "does not send a stale bearer after refresh %s",
  async (status) => {
    mocks.refresh.mockResolvedValueOnce({ status });
    const o = options();
    await expect(authorizeMarketInBackground(o)).rejects.toThrow(
      "market_reauthorization_required"
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(o.cancel).toHaveBeenCalledOnce();
  }
);
it("sanitizes transport failures and keeps token-refresh updates within the same attempt", async () => {
  const o = options();
  vi.mocked(fetch).mockImplementationOnce(async () => {
    createInstrumentedStore().set(org2CloudAuthAtom, {
      ...auth,
      accessToken: "rotated-token",
    } as never);
    throw Error("private transport detail including credentials");
  });
  await expect(authorizeMarketInBackground(o)).rejects.toThrow(
    "market_request_failed"
  );
  expect(o.complete).not.toHaveBeenCalled();
  expect(o.cancel).toHaveBeenCalledOnce();
});
it("allows ordinary token rotation without cancelling a successful request", async () => {
  const o = options();
  vi.mocked(fetch).mockImplementationOnce(async () => {
    createInstrumentedStore().set(org2CloudAuthAtom, {
      ...auth,
      accessToken: "rotated-token",
    } as never);
    return Response.json(response());
  });
  await authorizeMarketInBackground(o);
  expect(o.complete).toHaveBeenCalledOnce();
  expect(o.cancel).not.toHaveBeenCalled();
});
