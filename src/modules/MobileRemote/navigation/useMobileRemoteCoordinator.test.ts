// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileConnectionConfig } from "../connection/types";
import { useMobileRemoteCoordinator } from "./useMobileRemoteCoordinator";

const mocks = vi.hoisted(() => ({
  stopSession: vi.fn(),
  disconnect: vi.fn(),
  connectionConfig: null as MobileConnectionConfig | null,
}));
vi.mock("../app", () => ({
  useMobileRemote: () => ({
    connection: { status: "disconnected", demoMode: false },
    sessions: [],
    ...mocks,
  }),
}));

describe("useMobileRemoteCoordinator", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useMobileRemoteCoordinator>;
  let renderedScreens: string[];
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previous: boolean | undefined;
  function Probe({ intent = null }: { intent?: string | null }) {
    const value = useMobileRemoteCoordinator(intent);
    renderedScreens.push(value.nav.screen);
    React.useEffect(() => {
      current = value;
    });
    return React.createElement("div", null, value.nav.screen);
  }
  beforeEach(() => {
    previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.stopSession.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.connectionConfig = null;
    renderedScreens = [];
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(React.createElement(Probe)));
  });
  afterEach(() => {
    act(() => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  it("opens sessions for a restored device before the transport connects", () => {
    renderedScreens = [];
    mocks.connectionConfig = { wsUrl: "wss://relay.example.com/mobile/ws" };
    act(() => root.render(React.createElement(Probe)));
    expect(renderedScreens[0]).toBe("sessions");
    expect(container.textContent).toBe("sessions");
    expect(current.showTabBar).toBe(true);
  });
  it("keeps first-time devices on welcome", () => {
    expect(container.textContent).toBe("welcome");
  });
  it("does not treat a fresh pairing code as a restored device", () => {
    mocks.connectionConfig = {
      wsUrl: "wss://relay.example.com/mobile/ws",
      pairingCode: "fresh-code",
    };
    act(() => root.render(React.createElement(Probe)));
    expect(container.textContent).toBe("welcome");
    act(() =>
      current.handleAcceptPairing({
        config: mocks.connectionConfig!,
        requiresSas: true,
        sasPhrase: "verify-me",
      })
    );
    expect(container.textContent).toBe("sas");
  });
  it("keeps an explicit new pairing intent ahead of a restored device", () => {
    mocks.connectionConfig = { wsUrl: "wss://old.example.com/mobile/ws" };
    act(() =>
      root.render(
        React.createElement(Probe, {
          intent: "wss://relay.example.com/mobile/ws?token=test",
        })
      )
    );
    expect(container.textContent).toBe("connecting");
    expect(current.nav.pendingConfig?.wsUrl).toContain("relay.example.com");
  });
  it("consumes a recovered pairing link once and preserves subsequent navigation", () => {
    const intent = "wss://relay.example.com/mobile/ws?token=test";
    act(() => root.render(React.createElement(Probe, { intent })));
    expect(container.textContent).toBe("connecting");
    act(() => current.handleConnectingComplete());
    act(() => root.render(React.createElement(Probe, { intent })));
    expect(container.textContent).toBe("sessions");
    expect(current.nav.pendingConfig).toBeNull();
  });
  it("keeps SAS confirmation before connecting and clears pairing data on completion", () => {
    act(() =>
      current.handleAcceptPairing({
        config: { wsUrl: "wss://relay.example.com" },
        requiresSas: true,
        sasPhrase: "test-phrase",
      })
    );
    expect(container.textContent).toBe("sas");
    act(() => current.dispatch({ type: "confirm_sas" }));
    expect(container.textContent).toBe("connecting");
    act(() => current.handleConnectingComplete());
    expect(current.nav.sasPhrase).toBe("");
    expect(current.nav.pendingConfig).toBeNull();
  });
  it("single-flights stop and ignores completion after switching sessions", async () => {
    let finish!: () => void;
    mocks.stopSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    act(() => {
      current.dispatch({ type: "select_session", sessionId: "a" });
      current.dispatch({ type: "open_stop_modal" });
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleConfirmStop();
      await current.handleConfirmStop();
    });
    expect(mocks.stopSession).toHaveBeenCalledTimes(1);
    expect(current.stopConfirming).toBe(true);
    act(() => {
      current.dispatch({ type: "back_from_chat" });
      current.dispatch({ type: "select_session", sessionId: "b" });
      current.dispatch({ type: "open_stop_modal" });
    });
    await act(async () => {
      finish();
      await pending;
    });
    expect(current.nav.selectedSessionId).toBe("b");
    expect(current.nav.stopModalOpen).toBe(true);
    expect(current.stopConfirming).toBe(false);
  });
  it("releases the stop lock after rejection so another attempt is possible", async () => {
    act(() => {
      current.dispatch({ type: "select_session", sessionId: "a" });
      current.dispatch({ type: "open_stop_modal" });
    });
    mocks.stopSession.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(current.handleConfirmStop()).resolves.toBeUndefined();
    });
    expect(current.stopConfirming).toBe(false);
    expect(current.stopFailed).toBe(true);
    expect(current.nav.stopModalOpen).toBe(true);
    await act(async () => {
      await current.handleConfirmStop();
    });
    expect(mocks.stopSession).toHaveBeenCalledTimes(2);
    expect(current.stopFailed).toBe(false);
    expect(current.nav.stopModalOpen).toBe(false);
  });
  it("clears a stop failure when dismissed and does not leak it to another session", async () => {
    act(() => {
      current.dispatch({ type: "select_session", sessionId: "a" });
      current.dispatch({ type: "open_stop_modal" });
    });
    mocks.stopSession.mockRejectedValueOnce(new Error("private-token"));
    await act(async () => current.handleConfirmStop());
    expect(current.stopFailed).toBe(true);
    act(() => current.dispatch({ type: "close_stop_modal" }));
    expect(current.stopFailed).toBe(false);
    act(() => {
      current.dispatch({ type: "select_session", sessionId: "b" });
      current.dispatch({ type: "open_stop_modal" });
    });
    expect(current.stopFailed).toBe(false);
  });
  it("ignores a late stop failure after switching the connection scope", async () => {
    let reject!: (reason: Error) => void;
    mocks.stopSession.mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    act(() => {
      current.dispatch({ type: "select_session", sessionId: "a" });
      current.dispatch({ type: "open_stop_modal" });
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleConfirmStop();
    });
    mocks.connectionConfig = {
      wsUrl: "wss://another-desktop.example/mobile/ws",
    };
    act(() => root.render(React.createElement(Probe)));
    await act(async () => {
      reject(new Error("old desktop rejected"));
      await pending;
    });
    expect(current.stopFailed).toBe(false);
    expect(current.stopConfirming).toBe(false);
  });
});
