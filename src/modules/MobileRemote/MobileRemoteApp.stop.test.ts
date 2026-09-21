// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileRemoteApp } from "./MobileRemoteApp";

/**
 * Regression guard for the M-15 stop confirmation: the coordinator kept the
 * whole stop state machine while the render site was dropped, so Stop had no
 * confirmation at all. These tests drive the real coordinator, the real chat
 * top bar and the real StopConfirmModal — a coordinator-only test cannot see
 * that the modal is unmounted.
 */
const state = vi.hoisted(() => ({
  stopSession: vi.fn(),
}));

vi.mock("./app", () => ({
  MobileRemoteProviders: ({ children }: React.PropsWithChildren) => children,
  useMobileRemote: () => ({
    connection: {
      status: "connected",
      presence: "online",
      desktopId: "one",
      tier: "full",
      demoMode: false,
      capabilities: {},
    },
    connectionConfig: { desktopId: "one", host: "localhost", port: 8787 },
    sessions: [{ id: "a", name: "Session A", status: "running" }],
    rpc: null,
    bootstrapPending: false,
    openedSession: null,
    openingReady: false,
    transcriptItems: [],
    transcriptPhase: "ready",
    transcriptRounds: [],
    transcriptRoundsComplete: true,
    sessionModel: { options: [], loading: false, patching: false },
    subscribeSession: () => Promise.resolve(),
    unsubscribeSession: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(),
    stopSession: state.stopSession,
    disconnect: () => Promise.resolve(),
    retryConnection: () => Promise.resolve(),
  }),
}));
vi.mock("./screens/SessionsScreen", () => ({
  SessionsScreen: ({
    active,
    onSelectSession,
  }: {
    active: boolean;
    onSelectSession: (id: string) => void;
  }) =>
    active
      ? React.createElement(
          "button",
          { onClick: () => onSelectSession("a") },
          "Open session"
        )
      : null,
}));
vi.mock("./components/profile/MobileProfileEntry", () => ({
  MobileProfileEntry: () => null,
}));
vi.mock("./components/transcript/ChatTranscript", () => ({
  ChatTranscript: () => null,
}));
vi.mock("./components/transcript/RoundNavigator", () => ({
  RoundNavigator: () => null,
}));
vi.mock("./components/composer/MobileComposer", () => ({
  MobileComposer: () => null,
}));
vi.mock("@src/components/PermissionPrompt", () => ({
  PermissionSheet: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en" },
  }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previous: boolean | undefined;
beforeEach(() => {
  previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  state.stopSession.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  environment.IS_REACT_ACT_ENVIRONMENT = previous;
});

const render = () =>
  act(async () =>
    root.render(
      React.createElement(MobileRemoteApp, { authUserId: "test-account" })
    )
  );
const click = (text: string) =>
  act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (el) => el.textContent === text
    );
    if (!button) throw new Error(`Missing ${text}`);
    button.click();
  });
const stopButton = () =>
  host.querySelector<HTMLButtonElement>('[aria-label="stopConfirm.confirm"]');
const modalConfirm = () =>
  document.body.querySelector<HTMLButtonElement>("[data-modal-primary-action]");

it("asks for confirmation before the stop request leaves the device", async () => {
  await render();
  await click("Open session");

  // The chat top bar owns the stop affordance.
  expect(stopButton()).not.toBeNull();
  expect(modalConfirm()).toBeNull();

  await act(async () => stopButton()!.click());

  // Confirmation is rendered, and nothing has been cancelled yet.
  expect(modalConfirm()).not.toBeNull();
  expect(document.body.textContent).toContain("stopConfirm.body");
  expect(state.stopSession).not.toHaveBeenCalled();

  await act(async () => modalConfirm()!.click());

  expect(state.stopSession).toHaveBeenCalledTimes(1);
  expect(state.stopSession).toHaveBeenCalledWith("a");
});

it("leaves the run alone when the confirmation is dismissed", async () => {
  await render();
  await click("Open session");
  await act(async () => stopButton()!.click());
  expect(modalConfirm()).not.toBeNull();

  const cancel = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button")
  ).find((el) => el.textContent === "stopConfirm.cancel");
  await act(async () => cancel!.click());

  expect(state.stopSession).not.toHaveBeenCalled();
});
