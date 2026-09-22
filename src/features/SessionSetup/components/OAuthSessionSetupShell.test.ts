// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type OAuthSessionSetupCaptureState,
  type OAuthSessionSetupCopy,
  OAuthSessionSetupShell,
  type OAuthSessionSetupShellProps,
} from "./OAuthSessionSetupShell";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const copy: OAuthSessionSetupCopy = {
  signInTitle: "Sign in",
  signInDescription: "Connect your account",
  signInButton: "Continue",
  signedInTitle: "Connected",
  signedInStatus: "Signed in",
  loginStep: "Login",
  browserHint: "Complete login in the browser",
  readyTitle: "Ready to sign in",
  oauthHint: "The browser will open here",
  loading: "Loading",
  failedToLoadBrowser: "Browser failed",
  retry: "Retry",
  errorHint: "Try signing in again",
};

function makeCapture(
  overrides: Partial<OAuthSessionSetupCaptureState> = {}
): OAuthSessionSetupCaptureState {
  return {
    isSigningIn: false,
    isSignedIn: false,
    isWebviewOpen: false,
    isWebviewLoading: false,
    currentUrl: "",
    authUrl: null,
    error: null,
    startLogin: vi.fn(() => Promise.resolve()),
    closeWebview: vi.fn(() => Promise.resolve()),
    reset: vi.fn(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function renderShell(
  props: Partial<OAuthSessionSetupShellProps> & {
    capture: OAuthSessionSetupCaptureState;
  }
): void {
  act(() => {
    root.render(
      createElement(OAuthSessionSetupShell, {
        providerId: "provider",
        containerRef: createRef<HTMLDivElement>(),
        hasToken: false,
        copy,
        ...props,
      })
    );
  });
}

const query = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector);

const signInButton = () =>
  query<HTMLButtonElement>('[data-testid="provider-oauth-signin"]');
const browserShell = () =>
  query('[data-testid="provider-oauth-browser-shell"]');
const closeButton = () =>
  query<HTMLButtonElement>('[data-testid="provider-oauth-browser-close"]');

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

describe("OAuthSessionSetupShell browser lifecycle", () => {
  it("opens the browser on sign-in and starts exactly one login per open", async () => {
    const capture = makeCapture();
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, onBrowserStateChange });

    expect(signInButton()?.textContent).toBe("Continue");
    expect(browserShell()).toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);

    act(() => signInButton()?.click());

    expect(browserShell()).not.toBeNull();
    expect(signInButton()).toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(true);
    expect(capture.startLogin).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // The native webview can close on its own while the React surface stays
    // open (macOS popup handling). That must not schedule a second attempt,
    // even when the capture hook hands us a new startLogin identity.
    const replacementStart = vi.fn(() => Promise.resolve());
    renderShell({
      capture: makeCapture({ startLogin: replacementStart }),
      onBrowserStateChange,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
    expect(replacementStart).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(browserShell()).not.toBeNull();
  });

  it("clears the pending auto-start timer on unmount", async () => {
    const capture = makeCapture();
    renderShell({ capture });

    act(() => signInButton()?.click());
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(capture.startLogin).not.toHaveBeenCalled();

    // afterEach unmounts again; give it a fresh root so that stays a no-op.
    root = createRoot(container);
  });

  it("mounts with the browser open when initiallyOpen is set", async () => {
    const capture = makeCapture();
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, initiallyOpen: true, onBrowserStateChange });

    expect(browserShell()).not.toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(true);
    expect(
      query('[data-testid="provider-oauth-current-url"]')?.textContent
    ).toBe("Ready to sign in");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
  });

  it("collapses back to the idle view once sign-in completes and the webview closes", async () => {
    const onBrowserStateChange = vi.fn();
    renderShell({
      capture: makeCapture({ isWebviewOpen: true }),
      initiallyOpen: true,
      onBrowserStateChange,
    });
    expect(browserShell()).not.toBeNull();

    renderShell({
      capture: makeCapture({ isWebviewOpen: false, isSignedIn: true }),
      initiallyOpen: true,
      hasToken: true,
      onBrowserStateChange,
    });
    await flushMicrotasks();

    expect(browserShell()).toBeNull();
    expect(signInButton()?.textContent).toBe("✓ Signed in");
    expect(container.textContent).toContain("Connected");
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);
  });

  it("closes the native webview and returns to idle from the X button", () => {
    const capture = makeCapture({ isWebviewOpen: true });
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, initiallyOpen: true, onBrowserStateChange });

    act(() => closeButton()?.click());

    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
    expect(signInButton()).not.toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);
  });

  it("honors an external close signal only while the browser is visible", async () => {
    const capture = makeCapture();
    renderShell({ capture, closeSignal: 1 });
    await flushMicrotasks();
    expect(capture.closeWebview).not.toHaveBeenCalled();
    expect(signInButton()).not.toBeNull();

    renderShell({ capture, closeSignal: 0 });
    act(() => signInButton()?.click());
    expect(browserShell()).not.toBeNull();

    renderShell({
      capture: makeCapture({
        isWebviewOpen: true,
        closeWebview: capture.closeWebview,
      }),
      closeSignal: 1,
    });
    await flushMicrotasks();

    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
    expect(signInButton()).not.toBeNull();
  });

  it("retry resets the capture and starts a new login immediately", async () => {
    const capture = makeCapture({ error: "network unavailable" });
    renderShell({ capture, initiallyOpen: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Browser failed");
    expect(container.textContent).toContain("network unavailable");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry"
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());

    expect(capture.reset).toHaveBeenCalledTimes(1);
    expect(capture.startLogin).toHaveBeenCalledTimes(2);
    expect(browserShell()).not.toBeNull();
  });
});

describe("OAuthSessionSetupShell idle notices", () => {
  it("dismisses a capture error through reset", () => {
    const capture = makeCapture({ error: "state mismatch" });
    const onClearTokenError = vi.fn();
    renderShell({ capture, onClearTokenError });

    expect(container.textContent).toContain("state mismatch");
    expect(container.textContent).toContain("Try signing in again");

    const dismiss =
      query<HTMLButtonElement>('[data-icon="x"]')?.closest("button");
    expect(dismiss).not.toBeNull();
    act(() => dismiss?.click());

    expect(capture.reset).toHaveBeenCalledTimes(1);
    expect(onClearTokenError).not.toHaveBeenCalled();
  });

  it("dismisses a token error through onClearTokenError", () => {
    const capture = makeCapture();
    const onClearTokenError = vi.fn();
    renderShell({ capture, tokenError: "token rejected", onClearTokenError });

    expect(container.textContent).toContain("token rejected");

    const dismiss =
      query<HTMLButtonElement>('[data-icon="x"]')?.closest("button");
    act(() => dismiss?.click());

    expect(onClearTokenError).toHaveBeenCalledTimes(1);
    expect(capture.reset).not.toHaveBeenCalled();
  });

  it("renders provider debug content inside the shared debug container", () => {
    renderShell({
      capture: makeCapture(),
      debugContent: createElement("div", null, "Id Token: null"),
    });

    expect(container.textContent).toContain("Id Token: null");
  });
});
