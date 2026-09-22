// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileRemoteApp } from "./MobileRemoteApp";
import { MobileComposerDraftContext } from "./components/composer/MobileComposerDraftContext";
import { createMobileComposerDraftStore } from "./components/composer/mobileComposerDraftStore";

const state = vi.hoisted(() => ({
  desktopId: "one",
  send: vi.fn(),
  optimize: vi.fn(),
}));
vi.mock("./app", () => ({
  MobileRemoteProviders: ({ children }: React.PropsWithChildren) => {
    const store = React.useMemo(createMobileComposerDraftStore, []);
    React.useEffect(() => () => store.clear(), [store]);
    return React.createElement(
      MobileComposerDraftContext.Provider,
      { value: store },
      children
    );
  },
  useMobileRemote: () => ({
    connection: {
      status: "connected",
      presence: "online",
      desktopId: state.desktopId,
      tier: "full",
      demoMode: false,
    },
    connectionConfig: { desktopId: state.desktopId },
    transcriptItems: [],
    transcriptPhase: "ready",
    transcriptRounds: [],
    transcriptRoundsComplete: true,
    sessionModel: { options: [], loading: false, patching: false },
    subscribeSession: () => Promise.resolve(),
    unsubscribeSession: () => Promise.resolve(),
    sendMessage: state.send,
  }),
}));
vi.mock("./navigation/useMobileRemoteCoordinator", async () => {
  const { reduceMobileRemoteNav, createInitialMobileRemoteNavState } =
    await import("./navigation/mobileRemoteNavigation");
  return {
    useMobileRemoteCoordinator: () => {
      const [nav, dispatch] = React.useReducer(
        reduceMobileRemoteNav,
        createInitialMobileRemoteNavState({ screen: "sessions" })
      );
      return {
        connection: { status: "connected" },
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
vi.mock("./components/modals/StopConfirmModal", () => ({
  StopConfirmModal: () => null,
}));
vi.mock("./components/transcript/ChatTranscript", () => ({
  ChatTranscript: () => null,
}));
vi.mock("./components/transcript/RoundNavigator", () => ({
  RoundNavigator: () => null,
}));
vi.mock("./components/composer/MobileModelPicker", () => ({
  MobileModelPicker: () => null,
}));
vi.mock("./components/MobileTopBar", () => ({
  MobileTopBar: ({ onBack }: { onBack: () => void }) =>
    React.createElement("button", { onClick: onBack }, "Back"),
}));
vi.mock("@src/components/PermissionPrompt", () => ({
  PermissionSheet: () => null,
}));
vi.mock("@src/util/optimization/imageOptimizer", () => ({
  optimizeImage: (...args: unknown[]) => state.optimize(...args),
}));
vi.mock("@src/hooks/voice", () => ({
  useVoiceInput: () => ({
    isRecording: false,
    isSupported: false,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
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
  state.desktopId = "one";
  state.send.mockReset().mockResolvedValue(undefined);
  state.optimize.mockReset().mockImplementation(async (file: File) => ({
    dataUrl: `data:image/png;base64,${file.name}`,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  environment.IS_REACT_ACT_ENVIRONMENT = previous;
});
const render = (account = "user-a") =>
  act(async () =>
    root.render(React.createElement(MobileRemoteApp, { authUserId: account }))
  );
const click = (text: string) =>
  act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (el) => el.textContent === text
    );
    if (!button) throw new Error(`Missing ${text}`);
    button.click();
  });
const enter = (text: string) =>
  act(async () => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const attach = (name: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], name, { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

it("restores text and photos through the actual chat/list route unmount and keeps desktop/account scopes separate", async () => {
  await render();
  await click("Open session");
  await enter("unfinished");
  await attach("one.png");
  await click("Back");
  expect(host.querySelector("textarea")).toBeNull();
  await click("Open session");
  expect(host.querySelector("textarea")?.value).toBe("unfinished");
  expect(host.querySelector('img[src*="one.png"]')).not.toBeNull();
  state.desktopId = "two";
  await render();
  expect(host.querySelector("textarea")?.value).toBe("");
  await enter("other computer");
  state.desktopId = "one";
  await render();
  expect(host.querySelector("textarea")?.value).toBe("unfinished");
  await render("user-b");
  await click("Open session");
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(host.querySelector('img[src*="one.png"]')).toBeNull();
  await render("user-a");
  await click("Open session");
  expect(host.querySelector("textarea")?.value).toBe("");
});

it("keeps failed submissions, preserves newer text/photos after success, and locks duplicate sends across navigation", async () => {
  await render();
  await click("Open session");
  await enter("first");
  await attach("one.png");
  state.send.mockRejectedValueOnce(new Error("offline"));
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[data-testid="mobile-composer-send"]')!
      .click()
  );
  expect(host.querySelector("textarea")?.value).toBe("first");
  expect(host.textContent).toContain("offline");
  let finish!: () => void;
  state.send.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[data-testid="mobile-composer-send"]')!
      .click()
  );
  await click("Back");
  await click("Open session");
  expect(
    host.querySelector<HTMLButtonElement>(
      '[data-testid="mobile-composer-send"]'
    )?.disabled
  ).toBe(true);
  await enter("new edit");
  // Editing back to the same contents is still newer intent, not the sent snapshot.
  await enter("first");
  await attach("two.png");
  await act(async () => finish());
  expect(host.querySelector("textarea")?.value).toBe("first");
  expect(host.querySelector('img[src*="one.png"]')).toBeNull();
  expect(host.querySelector('img[src*="two.png"]')).not.toBeNull();
  expect(state.send).toHaveBeenCalledTimes(2);
});

it("finishes one image preparation while chat is unmounted and restores it on return", async () => {
  let finish!: (result: { dataUrl: string }) => void;
  state.optimize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("Open session");
  await attach("preparing.png");
  await attach("duplicate.png");
  expect(state.optimize).toHaveBeenCalledTimes(1);
  await click("Back");
  await act(async () =>
    finish({ dataUrl: "data:image/png;base64,preparing.png" })
  );
  await click("Open session");
  expect(host.querySelector('img[src*="preparing.png"]')).not.toBeNull();
  expect(
    host.querySelector<HTMLButtonElement>(
      '[data-testid="mobile-composer-send"]'
    )?.disabled
  ).toBe(false);
});

it("does not apply a late image preparation result to another account", async () => {
  let finish!: (result: { dataUrl: string }) => void;
  state.optimize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("Open session");
  await attach("late.png");
  await render("user-b");
  await click("Open session");
  await enter("private new draft");
  await act(async () => finish({ dataUrl: "data:image/png;base64,late.png" }));
  expect(host.querySelector("textarea")?.value).toBe("private new draft");
  expect(host.querySelector('img[src*="late.png"]')).toBeNull();
});
