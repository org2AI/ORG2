// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { MobileRemoteApp } from "./MobileRemoteApp";
import {
  MobileAuthContext,
  type MobileAuthContextValue,
} from "./auth/MobileAuthContext";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), dispose: vi.fn() }));
vi.mock("./app", async () => {
  const React = await import("react");
  return {
    MobileRemoteProviders: () => {
      React.useEffect(() => {
        lifecycle.mount();
        return lifecycle.dispose;
      }, []);
      return null;
    },
    useMobileRemote: vi.fn(),
  };
});

it("disposes connection, inbox and search owners on account/endpoint changes, not token refresh", async () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const before = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  let value: MobileAuthContextValue = {
    isDevelopmentBypass: false,
    signOut: vi.fn(),
    session: {
      kind: "org2_cloud",
      userId: "one",
      supabaseUrl: "https://one.example",
      supabaseAnonKey: "public",
      accessToken: "first",
      refreshToken: "refresh",
      expiresAt: 1000,
    },
  };
  const render = () =>
    act(async () =>
      root.render(
        React.createElement(
          MobileAuthContext.Provider,
          { value },
          React.createElement(MobileRemoteApp, {
            authUserId: value.session.userId,
          })
        )
      )
    );
  try {
    await render();
    value = {
      ...value,
      session: { ...value.session, accessToken: "refreshed" },
    };
    await render();
    expect(lifecycle.mount).toHaveBeenCalledTimes(1);
    value = { ...value, session: { ...value.session, userId: "two" } };
    await render();
    expect(lifecycle.dispose).toHaveBeenCalledTimes(1);
    value = {
      ...value,
      session: { ...value.session, supabaseUrl: "https://two.example" },
    };
    await render();
    expect(lifecycle.mount).toHaveBeenCalledTimes(3);
    expect(lifecycle.dispose).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = before;
  }
});
