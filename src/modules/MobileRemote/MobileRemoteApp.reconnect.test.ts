// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n, { i18nReady } from "@src/i18n";
import enMobileRemote from "@src/i18n/locales/en/mobileRemote.json";

import { MobileRemoteApp } from "./MobileRemoteApp";
import { MobileAuthContext } from "./auth/MobileAuthContext";
import { MobileRemotePlatformProvider } from "./platform";
import { createBrowserMobileRemotePlatform } from "./platform/browser";

// Only the transport is simulated: the root render gate, navigation, provider,
// RPC framing, storage and session/offline UI run their production code.
class RelaySocket extends EventTarget {
  readyState = 0;
  static online = false;
  static instances: RelaySocket[] = [];

  constructor(readonly url: string) {
    super();
    RelaySocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      // Relay recognizes this fixture's durable credential even if an older
      // app retained its expired one-time code; Desktop need not be online.
      queueMicrotask(() =>
        this.receive({ jsonrpc: "2.0", method: "pairing/approved", params: {} })
      );
    });
  }
  receive(message: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(message) })
    );
  }
  send(raw: string) {
    const request = JSON.parse(raw);
    if (request.id == null) return;
    queueMicrotask(() =>
      this.receive({
        jsonrpc: "2.0",
        id: request.id,
        ...(!RelaySocket.online
          ? { error: { code: -32006, message: "desktop is offline" } }
          : {
              result:
                request.method === "initialize"
                  ? {
                      protocolVersion: 1,
                      tier: "full",
                      desktopId: "fixture-desktop",
                    }
                  : { sessions: [] },
            }),
      })
    );
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code }));
  }
}

const PlatformProvider = MobileRemotePlatformProvider as React.ComponentType<
  React.PropsWithChildren<
    Omit<React.ComponentProps<typeof MobileRemotePlatformProvider>, "children">
  >
>;

describe("MobileRemoteApp paired-device recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previousActEnvironment: boolean | undefined;
  let platform: ReturnType<typeof createBrowserMobileRemotePlatform>;
  beforeEach(async () => {
    previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    RelaySocket.online = false;
    RelaySocket.instances = [];
    platform = createBrowserMobileRemotePlatform();
    platform.connection.createSocket = (url) =>
      new RelaySocket(url) as unknown as WebSocket;
    platform.runtime.random = () => 0;
    await i18nReady;
    i18n.addResourceBundle("en", "mobileRemote", enMobileRemote, true, true);
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  async function render() {
    await act(async () =>
      root.render(
        React.createElement(
          I18nextProvider,
          { i18n },
          React.createElement(
            PlatformProvider,
            { platform },
            React.createElement(
              MobileAuthContext.Provider,
              {
                value: {
                  isDevelopmentBypass: false,
                  signOut: vi.fn(),
                  session: {
                    kind: "org2_cloud",
                    userId: "reconnect-fixture",
                    supabaseUrl: "https://auth.example.test",
                    supabaseAnonKey: "fixture-public",
                    accessToken: "fixture-access",
                    refreshToken: "fixture-refresh",
                    expiresAt: 9999999999,
                  },
                },
              },
              React.createElement(MobileRemoteApp, {
                authUserId: "reconnect-fixture",
              })
            )
          )
        )
      )
    );
  }

  it("keeps the session page across offline launch and transport loss, but honors revocation", async () => {
    const config = {
      wsUrl: "wss://relay.example.test/v1/mobile/ws",
      desktopId: "fixture-desktop",
      deviceToken: "fixture-credential",
    };
    await platform.connection.save("reconnect-fixture", config);
    await render();
    expect(container.querySelector(".mobile-discovery")).not.toBeNull();
    expect(container.textContent).not.toContain(enMobileRemote.welcome.scanQr);
    expect(RelaySocket.instances).toHaveLength(1);
    RelaySocket.online = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(RelaySocket.instances).toHaveLength(2);
    expect(container.querySelector(".mobile-discovery")).not.toBeNull();
    await act(async () => RelaySocket.instances.at(-1)!.close(1006));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(RelaySocket.instances).toHaveLength(3);
    expect(await platform.connection.load("reconnect-fixture")).toEqual(config);
    expect(container.querySelector(".mobile-discovery")).not.toBeNull();
    await act(async () => RelaySocket.instances.at(-1)!.close(1008));
    expect(container.querySelector(".mobile-discovery")).toBeNull();
    expect(container.textContent).toContain(
      "This device’s access is no longer valid"
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(RelaySocket.instances).toHaveLength(3);
  });

  it("repairs an old paired record only after Relay approval and restores sessions while Desktop is offline", async () => {
    await platform.connection.save("reconnect-fixture", {
      wsUrl: "wss://relay.example.test/v1/mobile/ws",
      desktopId: "fixture-desktop",
      deviceToken: "fixture-credential",
      pairingCode: "old-one-time-code",
    });
    await render();
    expect(container.querySelector(".mobile-discovery")).not.toBeNull();
    expect(
      (await platform.connection.load("reconnect-fixture"))?.pairingCode
    ).toBeUndefined();
    RelaySocket.online = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(RelaySocket.instances).toHaveLength(2);
    expect(
      new URL(RelaySocket.instances[1].url).searchParams.has("pairingCode")
    ).toBe(false);
    expect(container.querySelector(".mobile-discovery")).not.toBeNull();
  });
});
