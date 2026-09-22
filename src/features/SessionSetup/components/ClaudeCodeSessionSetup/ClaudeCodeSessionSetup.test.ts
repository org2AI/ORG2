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

import type { ClaudeCodeOauthExchangeResponse } from "@src/api/tauri/rpc/schemas/validation";

import ClaudeCodeSessionSetup from "./index";

const mocks = vi.hoisted(() => ({
  useClaudeCodeOAuthCapture: vi.fn(),
  useWebviewPositionSync: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/features/SessionSetup/hooks/useClaudeCodeOAuthCapture", () => ({
  useClaudeCodeOAuthCapture: mocks.useClaudeCodeOAuthCapture,
}));

vi.mock("@src/features/SessionSetup/hooks/useWebviewPositionSync", () => ({
  useWebviewPositionSync: mocks.useWebviewPositionSync,
}));

type CaptureOptions = {
  containerRef: { current: HTMLDivElement | null };
  debug: boolean;
  onTokenCaptured: (response: ClaudeCodeOauthExchangeResponse) => void;
};

function makeCaptureState(
  overrides: Partial<ReturnType<typeof baseCaptureState>> = {}
) {
  return { ...baseCaptureState(), ...overrides };
}

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
    expiresIn: null as number | null,
    startLogin: vi.fn(() => Promise.resolve()),
    closeWebview: vi.fn(() => Promise.resolve()),
    reset: vi.fn(),
    updatePosition: vi.fn(() => Promise.resolve()),
  };
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

let container: HTMLDivElement;
let root: Root;

function render(
  props: Parameters<typeof ClaudeCodeSessionSetup>[0] = {}
): void {
  act(() => {
    root.render(createElement(ClaudeCodeSessionSetup, props));
  });
}

function lastCaptureOptions(): CaptureOptions {
  const calls = mocks.useClaudeCodeOAuthCapture.mock.calls;
  return calls[calls.length - 1][0] as CaptureOptions;
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.useClaudeCodeOAuthCapture.mockReturnValue(makeCaptureState());
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

describe("ClaudeCodeSessionSetup", () => {
  it("renders its idle capture UI through the shared shell", () => {
    render();

    expect(
      container.querySelector('[data-testid="claude-code-session-setup"]')
    ).not.toBeNull();
    const signIn = container.querySelector<HTMLButtonElement>(
      '[data-testid="claude-code-oauth-signin"]'
    );
    expect(signIn?.textContent).toBe("keyVault.signInWithClaudeCode");
    expect(
      container.querySelector('[data-testid="claude-code-oauth-browser-shell"]')
    ).toBeNull();

    const options = lastCaptureOptions();
    expect(options.debug).toBe(false);
    expect(mocks.useWebviewPositionSync).toHaveBeenLastCalledWith(
      options.containerRef,
      false,
      expect.any(Function)
    );
  });

  it("opens the browser and auto-starts one login through the shell", async () => {
    const state = makeCaptureState();
    mocks.useClaudeCodeOAuthCapture.mockReturnValue(state);
    const onBrowserStateChange = vi.fn();
    render({ onBrowserStateChange });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="claude-code-oauth-signin"]'
        )
        ?.click();
    });

    expect(
      container.querySelector('[data-testid="claude-code-oauth-browser-shell"]')
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="claude-code-oauth-webview-container"]'
      )
    ).toBe(lastCaptureOptions().containerRef.current);
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain("keyVault.claudeCodeBrowserHint");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(state.startLogin).toHaveBeenCalledTimes(1);
  });

  it("maps a captured response into Claude Code session values", () => {
    const onSessionCaptured = vi.fn();
    render({ onSessionCaptured });

    lastCaptureOptions().onTokenCaptured({
      accessToken: "sk-ant-oat-access",
      refreshToken: null,
      expiresIn: 3600,
      accountMetadata: {
        email: "dev@example.com",
        organizationUuid: "   ",
        organizationName: null,
        organizationType: undefined,
        rateLimitTier: "default_claude_max_5x",
      },
    });

    expect(onSessionCaptured).toHaveBeenCalledWith({
      accessToken: "sk-ant-oat-access",
      refreshToken: undefined,
      expiresIn: 3600,
      accountMetadata: {
        email: "dev@example.com",
        rate_limit_tier: "default_claude_max_5x",
      },
    });
  });

  it("omits account metadata when every field is blank", () => {
    const onSessionCaptured = vi.fn();
    render({ onSessionCaptured });

    lastCaptureOptions().onTokenCaptured({
      accessToken: "sk-ant-oat-access",
      refreshToken: "sk-ant-ort-refresh",
      accountMetadata: { email: "", organizationUuid: null },
    });

    expect(onSessionCaptured).toHaveBeenCalledWith({
      accessToken: "sk-ant-oat-access",
      refreshToken: "sk-ant-ort-refresh",
      expiresIn: undefined,
      accountMetadata: undefined,
    });
  });

  it("shows the signed-in state and Claude Code debug rows", () => {
    mocks.useClaudeCodeOAuthCapture.mockReturnValue(
      makeCaptureState({
        isSignedIn: true,
        accessToken: "sk-ant-oat-0123456789abcdefghijklmnop",
        refreshToken: "sk-ant-ort-refresh",
        expiresIn: 3600,
      })
    );
    render({ debug: true });

    expect(
      container.querySelector('[data-testid="claude-code-oauth-signin"]')
        ?.textContent
    ).toBe("✓ keyVault.signedIn");
    expect(container.textContent).toContain("keyVault.claudeCodeSignedIn");
    expect(container.textContent).toContain(
      "Access Token: sk-ant-oat-0123456789abc..."
    );
    expect(container.textContent).toContain(
      "Refresh Token: sk-ant-ort-refresh"
    );
    expect(container.textContent).toContain("Expires In: 3600");
    expect(container.textContent).not.toContain("Id Token:");
    expect(lastCaptureOptions().debug).toBe(true);
  });
});
