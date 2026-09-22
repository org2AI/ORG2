// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useMobileRemoteCoordinator } from "./useMobileRemoteCoordinator";

const mocks = vi.hoisted(() => ({
  retryConnection: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../app", () => ({
  useMobileRemote: () => ({
    connection: { status: "error", demoMode: false },
    connectionConfig: null,
    sessions: [],
    stopSession: vi.fn(),
    ...mocks,
  }),
}));

it("single-flights reconnection, consumes the old bridge intent, and keeps repair separate with visible failures", async () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useMobileRemoteCoordinator>;
  function Probe() {
    const value = useMobileRemoteCoordinator(null);
    React.useEffect(() => {
      current = value;
    });
    return null;
  }
  let reject!: (error: Error) => void;
  mocks.retryConnection.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  mocks.disconnect
    .mockRejectedValueOnce(new Error("locked"))
    .mockResolvedValue(undefined);
  try {
    act(() => root.render(React.createElement(Probe)));
    act(() =>
      current.handleAcceptPairing({
        config: { wsUrl: "wss://fixture.example/ws", pairingCode: "code" },
        requiresSas: false,
      })
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.handleConnectionRetry();
      await current.handleConnectionRetry();
    });
    expect(current.nav.pendingConfig).toBeNull();
    expect(current.connectionRecovering).toBe(true);
    expect(mocks.retryConnection).toHaveBeenCalledOnce();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error("offline"));
      await pending;
    });
    expect(current.connectionRecoveryError).toBe("retry");
    expect(current.connectionRecovering).toBe(false);
    act(() =>
      current.dispatch({ type: "select_session", sessionId: "keep-selection" })
    );
    await act(async () => current.handleConnectionRepair());
    expect(current.connectionRecoveryError).toBe("repair");
    expect(current.nav.screen).toBe("chat");
    await act(async () => current.handleConnectionRepair());
    expect(current.connectionRecoveryError).toBeNull();
    expect(current.nav.screen).toBe("welcome");
  } finally {
    act(() => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
