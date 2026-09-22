import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  CloudOAuthFlow,
  OAUTH_TTL_MS,
  validateOAuthConfig,
} from "./cloudOAuthFlow";

const endpoint = {
  webOrigin: "https://cloud.test",
  supabaseUrl: "https://auth.test",
  anonKey: "public-key",
};
const config = {
  version: 1,
  clientId: "desktop-client",
  authorizationEndpoint: "https://auth.test/auth/v1/oauth/authorize",
  tokenEndpoint: "https://auth.test/auth/v1/oauth/token",
  userEndpoint: "https://auth.test/auth/v1/oauth/userinfo",
  redirectUri: "https://cloud.test/auth/desktop/oauth/callback",
  scopes: ["email", "profile"],
};
const access = `e30.${btoa(JSON.stringify({ sub: "user-a" }))}.signature`;
const flows: CloudOAuthFlow[] = [];
function harness() {
  let identity = "",
    currentEndpoint = { ...endpoint },
    invalidate = () => {};
  const unwatch = vi.fn(),
    commit = vi.fn(() => true),
    stop = vi.fn(async () => {});
  const request = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).endsWith("/config")) return Response.json(config);
    if (String(url).endsWith("/token"))
      return Response.json({
        access_token: access,
        refresh_token: "app-refresh",
        expires_in: 3600,
      });
    return Response.json({ sub: "user-a" });
  });
  const start = vi.fn(async () => 49152);
  const flow = new CloudOAuthFlow({
    start,
    stop,
    fetch: request,
    endpoint: () => currentEndpoint,
    identity: () => identity,
    commit,
    watch: (f) => {
      invalidate = f;
      return unwatch;
    },
  });
  flows.push(flow);
  return {
    flow,
    request,
    commit,
    start,
    stop,
    unwatch,
    switchAccount: () => {
      identity = "user-b";
      invalidate();
    },
    switchEndpoint: () => {
      currentEndpoint = { ...endpoint, supabaseUrl: "https://other.test" };
      invalidate();
    },
  };
}
function callback(authorization: string, extra = "") {
  return `http://127.0.0.1:49152/org2-cloud/oauth/callback?state=${new URL(authorization).searchParams.get("state")}&code=one-time-code${extra}`;
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  flows.splice(0).forEach((f) => f.cancel());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("exchanges a local PKCE verifier exactly once and resumes the original action", async () => {
  const h = harness(),
    resume = vi.fn(),
    url = await h.flow.begin(resume);
  const authorization = new URL(url);
  expect(authorization.searchParams.get("state")).toMatch(
    /^org2v1\.49152\.[A-Za-z0-9_-]{43}$/
  );
  expect(authorization.searchParams.has("code_verifier")).toBe(false);
  await Promise.all([
    h.flow.complete(callback(url)),
    h.flow.complete(callback(url)),
  ]);
  const tokenCall = h.request.mock.calls.find(([url]) =>
    String(url).endsWith("/token")
  )!;
  const body = tokenCall[1]!.body as URLSearchParams;
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body.get("code_verifier")!)
    )
  );
  const challenge = Buffer.from(digest).toString("base64url");
  expect(authorization.searchParams.get("code_challenge")).toBe(challenge);
  expect(body.get("client_secret")).toBeNull();
  expect(h.request).toHaveBeenCalledTimes(3);
  expect(h.commit).toHaveBeenCalledWith(
    expect.objectContaining({
      refreshToken: "app-refresh",
      oauthClientId: "desktop-client",
    })
  );
  expect(resume).toHaveBeenCalledOnce();
  expect(h.unwatch).toHaveBeenCalledOnce();
});
it("ignores foreign state and rejects duplicate parameters or token fragments", async () => {
  const h = harness(),
    url = await h.flow.begin();
  await h.flow.complete(callback(url).replace("org2v1", "foreign"));
  await h.flow.complete(callback(url) + "#access_token=injected");
  expect(h.request).toHaveBeenCalledTimes(1);
  await expect(
    h.flow.complete(callback(url, "&code=second"))
  ).rejects.toThrow();
  expect(h.commit).not.toHaveBeenCalled();
});
it.each(["cancel", "account", "endpoint"])(
  "rejects a late exchange after %s",
  async (kind) => {
    const h = harness(),
      resume = vi.fn(),
      url = await h.flow.begin(resume);
    let finish!: (r: Response) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    );
    const completing = h.flow.complete(callback(url));
    if (kind === "cancel") h.flow.cancel();
    if (kind === "account") h.switchAccount();
    if (kind === "endpoint") h.switchEndpoint();
    finish(
      Response.json({
        access_token: access,
        refresh_token: "stale",
        expires_in: 3600,
      })
    );
    await completing;
    expect(h.commit).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  }
);
it("expires the receiver and continuation with no idle timer left", async () => {
  vi.useFakeTimers();
  const h = harness(),
    resume = vi.fn(),
    url = await h.flow.begin(resume);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(OAUTH_TTL_MS);
  await h.flow.complete(callback(url));
  expect(h.commit).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
  expect(h.stop).toHaveBeenCalledWith(49152);
  expect(vi.getTimerCount()).toBe(0);
});
it("closes a receiver that starts after the attempt was replaced", async () => {
  const h = harness();
  let started!: (port: number) => void;
  h.start.mockImplementationOnce(
    () =>
      new Promise((r) => {
        started = r;
      })
  );
  const first = h.flow.begin();
  const rejected = expect(first).rejects.toThrow();
  await vi.waitFor(() => expect(started).toBeTypeOf("function"));
  await h.flow.begin();
  started(49153);
  await rejected;
  expect(h.stop).toHaveBeenCalledWith(49153);
});
it("rejects untrusted metadata and a userinfo subject mismatch", async () => {
  expect(() =>
    validateOAuthConfig(
      { ...config, tokenEndpoint: "https://evil.test/token" },
      endpoint
    )
  ).toThrow();
  const h = harness(),
    url = await h.flow.begin();
  h.request.mockImplementationOnce(async () =>
    Response.json({
      access_token: access,
      refresh_token: "rt",
      expires_in: 3600,
    })
  );
  h.request.mockImplementationOnce(async () =>
    Response.json({ sub: "user-b" })
  );
  await expect(h.flow.complete(callback(url))).rejects.toThrow("mismatch");
  expect(h.commit).not.toHaveBeenCalled();
});
