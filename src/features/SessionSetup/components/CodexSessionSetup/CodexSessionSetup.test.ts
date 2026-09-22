// @vitest-environment jsdom
import { act, createElement } from "react";
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

import type { CodexOauthExchangeResponse } from "@src/api/tauri/rpc/schemas/validation";

import CodexSessionSetup from "./index";

const mocks = vi.hoisted(() => ({
  useCodexOAuthCapture: vi.fn(),
  useWebviewPositionSync: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/features/SessionSetup/hooks/useCodexOAuthCapture", () => ({
  useCodexOAuthCapture: mocks.useCodexOAuthCapture,
}));

vi.mock("@src/features/SessionSetup/hooks/useWebviewPositionSync", () => ({
  useWebviewPositionSync: mocks.useWebviewPositionSync,
}));

type CaptureOptions = {
  containerRef: { current: HTMLDivElement | null };
  debug: boolean;
  onTokenCaptured: (response: CodexOauthExchangeResponse) => void;
};

function baseCaptureState() {
  return {
    isSigningIn: false,
    isSignedIn: false,
    isWebviewOpen: false,
    isWebviewLoading: false,
    currentUrl: "",
    authUrl: null as string | null,
    error: null as string | null,
    accessToken: null as string | null,
    refreshToken: null as string | null,
    idToken: null as string | null,
    expiresIn: null as number | null,
    startLogin: vi.fn(() => Promise.resolve()),
    closeWebview: vi.fn(() => Promise.resolve()),
    reset: vi.fn(),
    updatePosition: vi.fn(() => Promise.resolve()),
  };
}

function makeCaptureState(
  overrides: Partial<ReturnType<typeof baseCaptureState>> = {}
) {
  return { ...baseCaptureState(), ...overrides };
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

let container: HTMLDivElement;
let root: Root;

function render(props: Parameters<typeof CodexSessionSetup>[0] = {}): void {
  act(() => {
    root.render(createElement(CodexSessionSetup, props));
  });
}

function lastCaptureOptions(): CaptureOptions {
  const calls = mocks.useCodexOAuthCapture.mock.calls;
  return calls[calls.length - 1][0] as CaptureOptions;
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.useCodexOAuthCapture.mockReturnValue(makeCaptureState());
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

describe("CodexSessionSetup", () => {
  it("renders its idle capture UI through the shared shell", () => {
    render();

    expect(
      container.querySelector('[data-testid="codex-session-setup"]')
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="codex-oauth-signin"]'
      )?.textContent
    ).toBe("keyVault.signInWithCodex");
    expect(
      container.querySelector('[data-testid="codex-oauth-browser-shell"]')
    ).toBeNull();
    expect(mocks.useWebviewPositionSync).toHaveBeenLastCalledWith(
      lastCaptureOptions().containerRef,
      false,
      expect.any(Function)
    );
  });

  it("mounts with the browser open and auto-starts once when autoStart is set", async () => {
    const state = makeCaptureState();
    mocks.useCodexOAuthCapture.mockReturnValue(state);
    const onBrowserStateChange = vi.fn();
    render({ autoStart: true, onBrowserStateChange });

    expect(
      container.querySelector('[data-testid="codex-oauth-browser-shell"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="codex-oauth-current-url"]')
        ?.textContent
    ).toBe("keyVault.codexReadyToSignIn");
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(state.startLogin).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(state.startLogin).toHaveBeenCalledTimes(1);
  });

  it("forwards the wizard close signal to the capture hook", async () => {
    const state = makeCaptureState({ isWebviewOpen: true });
    mocks.useCodexOAuthCapture.mockReturnValue(state);
    render({ autoStart: true, closeSignal: 0 });
    render({ autoStart: true, closeSignal: 1 });

    await act(async () => {
      await Promise.resolve();
    });

    expect(state.closeWebview).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="codex-oauth-browser-shell"]')
    ).toBeNull();
  });

  it("maps a captured response into Codex session values", () => {
    const onSessionCaptured = vi.fn();
    render({ onSessionCaptured });

    lastCaptureOptions().onTokenCaptured({
      accessToken: "codex-access",
      refreshToken: "codex-refresh",
      idToken: "codex-id",
      expiresIn: null,
    });

    expect(onSessionCaptured).toHaveBeenCalledWith({
      accessToken: "codex-access",
      refreshToken: "codex-refresh",
      idToken: "codex-id",
      expiresIn: undefined,
    });
  });

  it("shows the signed-in state and Codex debug rows including the id token", () => {
    mocks.useCodexOAuthCapture.mockReturnValue(
      makeCaptureState({
        isSignedIn: true,
        accessToken: "codex-access",
        refreshToken: "codex-refresh",
        idToken: "codex-id-token",
        expiresIn: 1200,
      })
    );
    render({ debug: true });

    expect(
      container.querySelector('[data-testid="codex-oauth-signin"]')?.textContent
    ).toBe("✓ keyVault.signedIn");
    expect(container.textContent).toContain("keyVault.codexSignedIn");
    expect(container.textContent).toContain("Access Token: codex-access...");
    expect(container.textContent).toContain("Id Token: codex-id-token...");
    expect(container.textContent).toContain("Expires In: 1200");
    expect(lastCaptureOptions().debug).toBe(true);
  });
});
