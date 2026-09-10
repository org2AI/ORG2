// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StopConfirmModal } from "../components/modals/StopConfirmModal";
import { useMobileRemoteCoordinator } from "./useMobileRemoteCoordinator";

const mocks = vi.hoisted(() => ({ stopSession: vi.fn(), disconnect: vi.fn() }));
vi.mock("../app", () => ({
  useMobileRemote: () => ({
    connection: { status: "disconnected", demoMode: false },
    sessions: [],
    ...mocks,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useMobileRemoteCoordinator", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useMobileRemoteCoordinator>;
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previous: boolean | undefined;
  function Probe({
    intent = null,
    modal = false,
  }: {
    intent?: string | null;
    modal?: boolean;
  }) {
    const value = useMobileRemoteCoordinator(intent);
    React.useEffect(() => {
      current = value;
    });
    if (modal)
      return React.createElement(StopConfirmModal, {
        visible: value.nav.stopModalOpen,
        confirming: value.stopConfirming,
        failed: value.stopFailed,
        onConfirm: () => void value.handleConfirmStop(),
        onCancel: () => value.dispatch({ type: "close_stop_modal" }),
      });
    return React.createElement("div", null, value.nav.screen);
  }
  beforeEach(() => {
    previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.stopSession.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(React.createElement(Probe)));
  });
  afterEach(() => {
    act(() => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
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
    act(() => current.dispatch({ type: "select_session", sessionId: "a" }));
    mocks.stopSession.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(current.handleConfirmStop()).resolves.toBeUndefined();
    });
    expect(current.stopConfirming).toBe(false);
    expect(current.stopFailed).toBe(true);
    await act(async () => {
      await current.handleConfirmStop();
    });
    expect(mocks.stopSession).toHaveBeenCalledTimes(2);
  });
  it("keeps the rendered stop dialog open on failure and retries the desktop command", async () => {
    await act(async () =>
      root.render(React.createElement(Probe, { modal: true }))
    );
    act(() => {
      current.dispatch({ type: "select_session", sessionId: "a" });
      current.dispatch({ type: "open_stop_modal" });
    });
    mocks.stopSession.mockRejectedValueOnce(new Error("offline"));
    const clickStop = async () => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-modal-primary-action]"
      );
      expect(button).not.toBeNull();
      await act(async () => button!.click());
    };
    await clickStop();
    expect(current.nav.stopModalOpen).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "stopConfirm.failed"
    );
    expect(mocks.stopSession).toHaveBeenCalledTimes(1);
    await clickStop();
    expect(mocks.stopSession).toHaveBeenCalledTimes(2);
    expect(mocks.stopSession).toHaveBeenLastCalledWith("a");
    expect(current.nav.stopModalOpen).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
