// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { Org2CloudLoginRows } from "./Org2CloudSection";
import {
  ORG2_CLOUD_AUTH_STORAGE_KEY,
  org2CloudAuthAtom,
} from "./org2CloudAuthAtom";
import * as entitlementCoordinator from "./org2CloudEntitlementCoordinator";

const mocks = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/features/Org2Cloud/useOrg2CloudSignIn", () => ({
  useOrg2CloudSignIn: () => mocks.signIn,
}));

it("settings preserves auth on cancel and clears it only after confirmation", async () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const store = createStore();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const reset = vi.spyOn(
    entitlementCoordinator,
    "resetOrgEntitlementCoordinator"
  );
  try {
    store.set(org2CloudAuthAtom, {
      kind: "org2_cloud",
      supabaseUrl: "https://cloud.example.test",
      supabaseAnonKey: "test-anon-key",
      userId: "user-1",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: 2_000_000_000,
    });
    await act(async () =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(Org2CloudLoginRows)
        )
      )
    );
    const open = () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="org2-cloud-sign-out"]'
        )!
        .click();
    const dialog = () => document.querySelector('[role="dialog"]');
    const clickAction = (label: string) =>
      Array.from(dialog()!.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click();
    await act(async () => open());
    expect(dialog()?.textContent).toContain("cloud.signOutConfirmBody");
    expect(reset).not.toHaveBeenCalled();
    expect(store.get(org2CloudAuthAtom)?.userId).toBe("user-1");
    await act(async () => clickAction("common:actions.cancel"));
    expect(dialog()).toBeNull();
    expect(store.get(org2CloudAuthAtom)?.userId).toBe("user-1");
    await act(async () => open());
    await act(async () => clickAction("cloud.signOut"));
    expect(reset).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith(store);
    expect(store.get(org2CloudAuthAtom)).toBeNull();
    expect(localStorage.getItem(ORG2_CLOUD_AUTH_STORAGE_KEY)).toBe("null");
    expect(dialog()).toBeNull();
    const login = () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="org2-cloud-sign-in"]')!
        .click();
    await act(async () => login());
    expect(dialog()?.textContent).toContain("cloud.signInModalBody");
    expect(dialog()?.querySelector('[title="Close"]')).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
    await act(async () => clickAction("common:actions.cancel"));
    expect(dialog()).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
    await act(async () => login());
    await act(async () => clickAction("cloud.signIn"));
    expect(dialog()).toBeNull();
    expect(mocks.signIn).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  }
});
