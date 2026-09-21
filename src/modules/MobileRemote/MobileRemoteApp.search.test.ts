// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileRemoteApp } from "./MobileRemoteApp";
import type { MobileRpcClient } from "./connection/mobileRpcClient";

const state = vi.hoisted(() => ({
  connection: {
    status: "connected",
    presence: "online",
    desktopId: "one",
    capabilities: { sessionSearch: true },
  },
  connectionConfig: { desktopId: "one", host: "localhost", port: 8787 },
  sessions: [{ id: "recent", name: "Recent", status: "idle" }],
  rpc: null as MobileRpcClient | null,
}));
vi.mock("./app", () => ({
  MobileRemoteProviders: ({ children }: React.PropsWithChildren) => children,
  useMobileRemote: () => state,
}));
vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  const { createBrowserMobileRemotePlatform } =
    await import("./platform/browser");
  const platform = createBrowserMobileRemotePlatform();
  return { ...actual, useMobileRemotePlatform: () => platform };
});
vi.mock("./navigation/useMobileRemoteCoordinator", async () => {
  const React = await import("react");
  const { reduceMobileRemoteNav, createInitialMobileRemoteNavState } =
    await import("./navigation/mobileRemoteNavigation");
  return {
    useMobileRemoteCoordinator: () => {
      const [nav, dispatch] = React.useReducer(
        reduceMobileRemoteNav,
        createInitialMobileRemoteNavState({ screen: "sessions" })
      );
      return {
        connection: state.connection,
        nav,
        dispatch,
        showTabBar: !nav.selectedSessionId,
        // Stop state is part of the hook's contract; this suite renders the
        // chat route, so keep the shape honest even though it stubs the modal.
        stopConfirming: false,
        stopFailed: false,
        handleConfirmStop: () => Promise.resolve(),
      };
    },
  };
});
vi.mock("./components/profile/MobileProfileEntry", () => ({
  MobileProfileEntry: () => null,
}));
vi.mock("./components/modals/StopConfirmModal", () => ({
  StopConfirmModal: () => null,
}));
vi.mock("./screens/SessionChatScreen", () => ({
  SessionChatScreen: ({ onBack }: { onBack: () => void }) =>
    React.createElement("button", { onClick: onBack }, "Back from chat"),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let call: ReturnType<typeof vi.fn>;
let previousActEnvironment: boolean | undefined;
const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
beforeEach(() => {
  previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  call = vi.fn().mockResolvedValue({
    sessions: [{ id: "historic", name: "Historic result", status: "idle" }],
    nextOffset: 50,
    hasMore: false,
  });
  state.rpc = { call } as unknown as MobileRpcClient;
  state.connectionConfig.desktopId = "one";
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
const render = () =>
  act(async () =>
    root.render(
      React.createElement(MobileRemoteApp, { authUserId: "test-account" })
    )
  );
const search = async () => {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="search.title"]')!
      .click()
  );
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, "history");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(200));
};

it("preserves inline search through the actual App route switch and back action", async () => {
  await render();
  await search();
  const results = host.querySelector(".mobile-discovery-scroll")!;
  results.scrollTop = 180;
  const row = Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="mobile-remote-session-row"]'
    )
  ).find((item) => item.textContent?.includes("Historic result"))!;
  await act(async () => row.click());
  expect(host.textContent).toBe("Back from chat");
  expect(host.querySelector("input")).toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector("input")?.value).toBe("history");
  expect(host.textContent).toContain("Historic result");
  expect(host.querySelector(".mobile-discovery-scroll")?.scrollTop).toBe(180);
  expect(call).toHaveBeenCalledTimes(1);
});

it("clears the retained search owner when the paired desktop changes", async () => {
  await render();
  await search();
  state.connectionConfig.desktopId = "two";
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).not.toContain("Historic result");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(call).toHaveBeenCalledTimes(1);
});
