// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AuthCallback from "./AuthCallback";

const mocks = vi.hoisted(() => ({
  exchangeCode: vi.fn(() =>
    Promise.resolve({ access_token: "access-token", expires_in: 3600 })
  ),
  navigate: vi.fn(),
  t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("@src/api/http/auth/supabase", () => ({
  exchangeSupabaseCodeForSession: mocks.exchangeCode,
}));

vi.mock("@src/config/routes", () => ({
  ROUTES: { workStation: { base: { path: "/orgii/workstation" } } },
}));

vi.mock("@src/config/serviceAuth", () => ({
  HOSTED_LOGIN_ENABLED: true,
  SERVICE_AUTH_STORAGE_KEYS: { accessToken: "access-token" },
  clearProcessedCode: () => Promise.resolve(),
  isCodeAlreadyProcessed: () => Promise.resolve(false),
  markCodeAsProcessed: () => Promise.resolve(),
  parseAuthCallback: () => ({ code: "oauth-code" }),
}));

vi.mock("@src/hooks/auth", async () => {
  const { atom } = await import("jotai");
  return {
    hostedTokenAtom: atom<string | null>(null),
    serviceAuthAtom: atom(false),
    serviceExpiryAtom: atom<number | null>(null),
    serviceValidatedAtom: atom(false),
  };
});

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

vi.mock("@src/hooks/navigation/useAppNavigate", () => ({
  useAppNavigate: () => mocks.navigate,
}));

vi.mock("./index", () => ({
  LoginLoadingState: ({
    error,
    stage,
  }: {
    error?: string | null;
    stage?: string;
  }) =>
    React.createElement("output", {
      "data-error": error ?? "",
      "data-stage": stage ?? "waiting",
    }),
}));

describe("AuthCallback", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("shows success before redirecting after the OAuth exchange completes", async () => {
    sessionStorage.setItem("login_redirect", "/orgii/mobile");

    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/orgii/auth/callback?code=oauth-code"] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: "/orgii/auth/callback",
              element: React.createElement(AuthCallback),
            })
          )
        )
      );
    });

    expect(mocks.exchangeCode).toHaveBeenCalledWith("oauth-code");
    expect(container.querySelector("output")?.getAttribute("data-stage")).toBe(
      "success"
    );
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mocks.navigate).toHaveBeenCalledWith("/orgii/mobile", {
      replace: true,
    });
  });
});
