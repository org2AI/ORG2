// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileRemoteApp } from "./MobileRemoteApp";

const mocks = vi.hoisted(() => ({ context: {} as Record<string, unknown> }));
vi.mock("./app", () => ({
  MobileRemoteProviders: ({ children }: React.PropsWithChildren) => children,
  useMobileRemote: () => mocks.context,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./components/MobileShell", () => ({
  MobileShell: ({ children }: React.PropsWithChildren) =>
    React.createElement("main", null, children),
}));
vi.mock("./components/MobileTabBar", () => ({ MobileTabBar: () => null }));
vi.mock("./components/profile/MobileProfileEntry", () => ({
  MobileProfileEntry: () => null,
}));
vi.mock("./screens/WelcomeScreen", () => ({
  WelcomeScreen: () => React.createElement("div", null, "pairing-home"),
}));
vi.mock("./screens/SessionChatScreen", () => ({
  SessionChatScreen: () => null,
}));
vi.mock("./screens/SessionsScreen", () => ({ SessionsScreen: () => null }));
vi.mock("./screens/devices/ConnectionDevicesScreen", () => ({
  ConnectionDevicesScreen: () => null,
}));
vi.mock("./screens/settings/SettingsTab", () => ({ SettingsTab: () => null }));
vi.mock("./components/MobileActionButton", () => ({
  MobileActionButton: ({
    children,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    React.createElement("button", props, children),
}));
vi.mock("@src/components/Placeholder", () => ({
  Placeholder: ({ title }: { title: string }) =>
    React.createElement("p", null, title),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousAct: boolean | undefined;
const render = () =>
  act(async () =>
    root.render(
      React.createElement(MobileRemoteApp, { authUserId: "test-user" })
    )
  );
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label
  )!;

beforeEach(() => {
  previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.context = {
    connection: {
      status: "error",
      presence: "offline",
      demoMode: false,
      error: { message: "Unavailable" },
    },
    connectionConfig: {
      desktopId: "desktop-a",
      wsUrl: "wss://relay.example/v1/mobile/ws",
    },
    sessions: [],
    bootstrapPending: false,
    retryConnection: vi.fn().mockRejectedValue(new Error("network failure")),
    disconnect: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

it("the error-page Reconnect action retries the selected connection and exposes failure without unpairing", async () => {
  await render();
  await act(async () => button("connectionRecovery.retry").click());
  expect(mocks.context.retryConnection).toHaveBeenCalledTimes(1);
  expect(mocks.context.disconnect).not.toHaveBeenCalled();
  expect(container.textContent).toContain("connectionRecovery.retryFailed");
  expect(button("connectionRecovery.retry").disabled).toBe(false);
  expect(container.textContent).not.toContain("pairing-home");
});

it("Pair again is separate and enters welcome only after successful reset", async () => {
  mocks.context.disconnect = vi.fn().mockImplementation(async () => {
    // The real provider clears runtime selection synchronously before its
    // persistence promise settles; mirror that ordering at this boundary.
    mocks.context = {
      ...mocks.context,
      connectionConfig: null,
      connection: {
        status: "disconnected",
        presence: "unknown",
        demoMode: false,
      },
    };
  });
  await render();
  await act(async () => button("connectionRecovery.repair").click());
  expect(mocks.context.disconnect).toHaveBeenCalledTimes(1);
  expect(mocks.context.retryConnection).not.toHaveBeenCalled();
  mocks.context = {
    ...mocks.context,
    connectionConfig: null,
    connection: {
      status: "disconnected",
      presence: "unknown",
      demoMode: false,
    },
  };
  await render();
  expect(container.textContent).toContain("pairing-home");
});

it("a failed reset remains on the error page with a recoverable message", async () => {
  mocks.context.disconnect = vi.fn().mockRejectedValue(new Error("storage"));
  await render();
  await act(async () => button("connectionRecovery.repair").click());
  expect(container.textContent).toContain("connectionRecovery.repairFailed");
  expect(container.textContent).not.toContain("pairing-home");
});

it("keeps recovery on a loading surface until the single handshake settles", async () => {
  let reject!: (error: Error) => void;
  mocks.context.retryConnection = vi.fn().mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await render();
  await act(async () => button("connectionRecovery.retry").click());
  expect(container.textContent).toContain("connection.restoring");
  expect(container.textContent).not.toContain("pairing-home");
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async () => reject(new Error("timeout")));
  expect(container.textContent).toContain("connectionRecovery.retryFailed");
  expect(mocks.context.retryConnection).toHaveBeenCalledTimes(1);
});
