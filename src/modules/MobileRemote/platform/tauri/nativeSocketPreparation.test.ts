import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MOBILE_REMOTE_RELAY_PRODUCTION_URL } from "@src/config/mobileRemoteRelay";

import type { MobileAuthSession } from "../../auth/mobileAuthState";
import { createNativeSocketPreparation } from "./nativeSocketPreparation";

const now = 1_800_000_000_000;
const session: MobileAuthSession = {
  kind: "org2_cloud",
  userId: "alice",
  supabaseUrl: "https://cloud.example",
  supabaseAnonKey: "public",
  accessToken: "cloud-secret",
  refreshToken: "refresh-secret",
  expiresAt: now / 1000 + 3600,
};
const config = {
  wsUrl: "wss://relay.example/v1/mobile/ws",
  desktopId: "desktop-a",
  deviceToken: "device-secret",
  pairingCode: "ABCDEFGH",
};
afterEach(() => vi.useRealTimers());
function fixture(
  fetcher = vi.fn(async () =>
    Response.json({
      ticket: "a".repeat(64),
      expiresAtMs: now + 60_000,
      authExpiresAtMs: session.expiresAt * 1000,
    })
  )
) {
  const controller = new AbortController();
  const runtime = {
    now: () => now,
    setTimeout: (cb: () => void, delay: number) =>
      setTimeout(cb, delay) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  };
  const prepare = createNativeSocketPreparation({
    trustedRelayUrls: [config.wsUrl],
    fetcher: fetcher as typeof fetch,
    runtime,
  });
  const getSession = vi.fn(async () => session);
  return {
    prepare,
    fetcher,
    controller,
    context: { signal: controller.signal, authUserId: "alice", getSession },
  };
}
describe("native Relay admission", () => {
  it("sends account/device credentials only to the trusted HTTP endpoint; WS gets only a ticket", async () => {
    const { prepare, fetcher, context } = fixture();
    const result = await prepare(config, context);
    const call = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(call[0])).toBe(
      "https://relay.example/v1/mobile/auth/connect-ticket"
    );
    expect(call[1].redirect).toBe("error");
    expect(call[1].credentials).toBe("omit");
    expect(new Headers(call[1].headers).get("authorization")).toBe(
      "Bearer cloud-secret"
    );
    expect(JSON.parse(call[1].body as string)).toEqual({
      desktopId: "desktop-a",
      deviceToken: "device-secret",
      pairingCode: "ABCDEFGH",
    });
    expect(result).toBe(
      `wss://relay.example/v1/mobile/ws?ticket=${"a".repeat(64)}`
    );
    expect(result).not.toMatch(/cloud-secret|device-secret|refresh-secret/);
  });
  it("does not send Cloud credentials to a QR-controlled host or a switched account", async () => {
    const { prepare, fetcher, context } = fixture();
    await expect(
      prepare(
        { ...config, wsUrl: "wss://attacker.example/v1/mobile/ws" },
        context
      )
    ).rejects.toThrow("trusted");
    expect(context.getSession).not.toHaveBeenCalled();
    await expect(
      prepare(config, { ...context, authUserId: "bob" })
    ).rejects.toThrow("changed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps LAN authentication independent of Cloud tickets", async () => {
    const { prepare, fetcher, context } = fixture();
    expect(
      await prepare({ host: "127.0.0.1", token: "lan-device" }, context)
    ).toBe("ws://127.0.0.1:13947/mobile/ws?token=lan-device");
    expect(context.getSession).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("discards late auth and ticket results after disconnect/account switch", async () => {
    const { prepare, fetcher, controller, context } = fixture();
    let resolve!: (value: MobileAuthSession) => void;
    context.getSession.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const operation = prepare(config, context);
    controller.abort();
    resolve(session);
    await expect(operation).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const late = fixture();
    late.fetcher.mockImplementation(async () => {
      late.controller.abort();
      return Response.json({ ticket: "a".repeat(64) });
    });
    await expect(late.prepare(config, late.context)).rejects.toThrow();
  });
  it("rejects expired/malformed tickets and always clears the request timer", async () => {
    vi.useFakeTimers();
    const { prepare, context } = fixture(
      vi.fn(async () => Response.json({ ticket: "bad", expiresAtMs: now }))
    );
    await expect(prepare(config, context)).rejects.toThrow("Invalid Relay");
    expect(vi.getTimerCount()).toBe(0);
    const ok = fixture();
    await ok.prepare(config, ok.context);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("allows native ticket fetches to the configured production Relay in the bundled CSP", () => {
  const config = JSON.parse(
    readFileSync("apps/remote-ios/src-tauri/tauri.conf.json", "utf8")
  );
  const relay = new URL(MOBILE_REMOTE_RELAY_PRODUCTION_URL);
  relay.protocol = relay.protocol === "wss:" ? "https:" : "http:";
  const connect = config.app.security.csp
    .split(";")
    .find((directive: string) => directive.trim().startsWith("connect-src "));
  expect(connect.trim().split(/\s+/)).toContain(relay.origin);
});
