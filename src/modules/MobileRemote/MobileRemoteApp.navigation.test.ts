// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileRemoteApp } from "./MobileRemoteApp";

const mocks = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("./app", () => ({
  MobileRemoteProviders: ({ children }: React.PropsWithChildren) => children,
  useMobileRemote: () => ({
    connection: {
      status: "connected",
      presence: "online",
      desktopId: "desktop-a",
      demoMode: false,
    },
    connectionConfig: { desktopId: "desktop-a", host: "localhost", port: 1 },
    sessions: [],
    bootstrapPending: false,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./components/profile/MobileProfileEntry", () => ({
  MobileProfileEntry: () => null,
}));
vi.mock("./screens/SessionChatScreen", () => ({
  SessionChatScreen: () => null,
}));
vi.mock("./screens/SessionsScreen", () => ({
  SessionsScreen: ({ active }: { active: boolean }) => {
    React.useEffect(() => {
      mocks.mounts++;
    }, []);
    return React.createElement(
      "div",
      { "data-testid": "sessions", hidden: !active },
      "sessions-body"
    );
  },
}));
vi.mock("./screens/settings/SettingsTab", () => ({
  SettingsTab: ({ onOpenDevices }: { onOpenDevices: () => void }) =>
    React.createElement("button", { onClick: onOpenDevices }, "open-devices"),
}));
vi.mock("./screens/devices/ConnectionDevicesScreen", () => ({
  ConnectionDevicesScreen: ({
    onBack,
    onAddDesktop,
  }: {
    onBack: () => void;
    onAddDesktop: () => void;
  }) =>
    React.createElement(
      "section",
      null,
      React.createElement("button", { onClick: onBack }, "back-settings"),
      React.createElement("button", { onClick: onAddDesktop }, "add-computer")
    ),
}));
vi.mock("./screens/QRScanScreen", () => ({
  QRScanScreen: ({
    onBack,
    onAcceptPairing,
  }: {
    onBack: () => void;
    onAcceptPairing: (value: unknown) => void;
  }) =>
    React.createElement(
      "section",
      null,
      React.createElement("button", { onClick: onBack }, "cancel-scan"),
      React.createElement(
        "button",
        {
          onClick: () =>
            onAcceptPairing({
              config: { host: "localhost" },
              requiresSas: false,
            }),
        },
        "accept-pairing"
      )
    ),
}));
vi.mock("./screens/ConnectingLiveBridge", () => ({
  ConnectingLiveBridge: ({ onComplete }: { onComplete: () => void }) =>
    React.createElement("button", { onClick: onComplete }, "complete-pairing"),
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const env = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let priorAct: boolean | undefined;
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === label
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};
beforeEach(async () => {
  priorAct = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.mounts = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      React.createElement(MobileRemoteApp, { authUserId: "test-user" })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  env.IS_REACT_ACT_ENVIRONMENT = priorAct;
});
it("offers two primary tabs and preserves the session list while visiting device settings", async () => {
  expect(
    Array.from(host.querySelectorAll("nav button")).map(
      (item) => item.textContent
    )
  ).toEqual(["tabs.sessions", "tabs.settings"]);
  await click("tabs.settings");
  await click("open-devices");
  expect(host.querySelector("nav")).toBeNull();
  expect(
    host.querySelector<HTMLElement>('[data-testid="sessions"]')?.hidden
  ).toBe(true);
  await click("back-settings");
  expect(host.textContent).toContain("open-devices");
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
    "tabs.settings"
  );
  await click("tabs.sessions");
  expect(
    host.querySelector<HTMLElement>('[data-testid="sessions"]')?.hidden
  ).toBe(false);
  expect(mocks.mounts).toBe(1);
});
it("returns from cancelled scanning and successful pairing to the settings destination", async () => {
  await click("tabs.settings");
  await click("open-devices");
  await click("add-computer");
  await click("cancel-scan");
  expect(host.textContent).toContain("back-settings");
  await click("add-computer");
  await click("accept-pairing");
  await click("complete-pairing");
  expect(host.textContent).toContain("back-settings");
  expect(host.querySelector("nav")).toBeNull();
  await click("back-settings");
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
    "tabs.settings"
  );
});
