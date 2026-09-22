// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePermissionTierLabel } from "../../connection/mobilePermissionPresentation";
import { SettingsTab } from "./SettingsTab";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  navigate: vi.fn(),
  bypass: false,
  connection: {
    status: "connected",
    presence: "online",
    desktopName: "Home Mac",
    tier: "full",
    demoMode: false,
  },
  config: {
    wsUrl:
      "wss://name:password@relay.example.test/v1/mobile/ws?ticket=secret#pairing",
  },
  themePreference: "system",
  themeStatus: "idle",
  setThemePreference: vi.fn(),
}));
vi.mock("../../platform", () => ({
  useMobileRemotePlatform: () => ({ openExternal: mocks.navigate }),
}));
vi.mock("../../app", () => ({
  useMobileRemote: () => ({
    connection: mocks.connection,
    connectionConfig: mocks.config,
  }),
}));
vi.mock("../../appearance", () => ({
  useMobileTheme: () => ({
    preference: mocks.themePreference,
    systemColorScheme: "light",
    resolvedColorScheme:
      mocks.themePreference === "system" ? "light" : mocks.themePreference,
    status: mocks.themeStatus,
    setPreference: mocks.setThemePreference,
  }),
}));
vi.mock("../../auth/MobileAuthContext", () => ({
  useMobileAuth: () => ({
    session: {
      userId: "user-a",
      profile: { primaryEmail: "mobile@example.test" },
    },
    signOut: mocks.signOut,
    isDevelopmentBypass: mocks.bypass,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const env = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousAct: boolean | undefined;
function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}
function button(label: string, scope: ParentNode = dialog() ?? host) {
  const result = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (item) =>
      item.getAttribute("aria-label") === label || item.textContent === label
  );
  expect(result, label).toBeTruthy();
  return result!;
}
async function click(label: string, scope?: ParentNode) {
  await act(async () => button(label, scope).click());
}
async function render(props = {}) {
  await act(async () =>
    root.render(
      React.createElement(SettingsTab, { onOpenDevices: vi.fn(), ...props })
    )
  );
}
beforeEach(() => {
  previousAct = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  mocks.navigate.mockReset().mockResolvedValue(undefined);
  mocks.signOut.mockReset();
  mocks.setThemePreference.mockReset().mockResolvedValue(undefined);
  mocks.themePreference = "system";
  mocks.themeStatus = "idle";
  mocks.bypass = false;
  mocks.connection.presence = "online";
  mocks.connection.desktopName = "Home Mac";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await act(async () => vi.advanceTimersByTime(1));
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  env.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

describe("SettingsTab shared account destination", () => {
  it("opens actual Profile, supports help/back and restores the Settings trigger on Escape", async () => {
    await render();
    expect(host.textContent).toContain("mobile@example.test");
    for (const key of [
      "settings.signOut",
      "settings.deleteAccount",
      "settings.privacyPolicy",
    ])
      expect(host.textContent).not.toContain(key);
    const trigger = button("mobile@example.test · profile.title", host);
    trigger.focus();
    await click("mobile@example.test · profile.title", host);
    await act(async () => vi.advanceTimersByTime(100));
    expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
    expect(document.activeElement).toBe(button("profile.close"));
    await click("profile.help");
    expect(document.activeElement).toBe(button("profile.back"));
    await click("profile.back");
    expect(dialog()?.textContent).toContain("mobile@example.test");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(host.textContent).toContain("Home Mac");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("retains shared confirmation: cancel returns to Profile, confirmed signout fires once after cleanup", async () => {
    await render();
    await click("mobile@example.test · profile.title", host);
    await click("settings.signOut");
    expect(dialog()?.getAttribute("aria-label")).toBe(
      "settings.signOutConfirmTitle"
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    await click("settings.cancel");
    expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
    await click("settings.signOut");
    mocks.signOut.mockImplementation(() => {
      expect(dialog()).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
    const confirm = button("settings.signOut");
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
  it("keeps web actions in Profile with retry and no local account deletion", async () => {
    await render();
    await click("mobile@example.test · profile.title", host);
    mocks.navigate.mockRejectedValueOnce(new Error("private failure"));
    await click("settings.manageAccount");
    expect(dialog()?.textContent).toContain("settings.openFailed");
    await click("settings.deleteAccount");
    expect(dialog()?.textContent).not.toContain("settings.openFailed");
    expect(dialog()?.textContent).toContain("profile.deleteHint");
    await click("settings.privacyPolicy");
    expect(mocks.navigate.mock.calls.map(([url]) => url)).toEqual([
      "https://org2-cloud-infra.vercel.app/account",
      "https://org2-cloud-infra.vercel.app/account",
      "https://org2-cloud-infra.vercel.app/legal/privacy",
    ]);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(dialog()?.querySelectorAll(".mobile-profile-group")).toHaveLength(3);
  });
  it("keeps desktop and permissions without a connection-details entry or hidden endpoint", async () => {
    const original = mocks.config.wsUrl;
    await render();
    expect(host.textContent).toContain("Home Mac");
    expect(
      host.querySelector(".mobile-settings__presence .sr-only")?.textContent
    ).toBe("settings.online");
    expect(host.textContent).not.toContain("settings.permissionTier");
    expect(host.textContent).not.toContain("settings.connectionDetails");
    expect(host.textContent).not.toContain("settings.relay");
    expect(host.textContent).not.toContain("settings.mode");
    expect(host.innerHTML).not.toMatch(
      /relay.example.test|password|ticket=secret|#pairing/
    );
    const connection = host.querySelector(
      '[data-testid="mobile-remote-connection-settings"]'
    )!;
    expect(
      connection.querySelector("button")?.getAttribute("aria-label")
    ).toBeNull();
    expect(mocks.config.wsUrl).toBe(original);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("keeps device identity and changing presence available to the row's accessible name", async () => {
    for (const [presence, label] of [
      ["online", "settings.online"],
      ["offline", "settings.offline"],
      ["unknown", "settings.notAvailable"],
    ]) {
      mocks.connection.presence = presence;
      await render();
      const row = host.querySelector<HTMLButtonElement>(
        ".mobile-settings__device-entry"
      )!;
      // Native buttons derive their accessible name from content. An ARIA name
      // on the row would override the device identity and presence below.
      expect(row.hasAttribute("aria-label")).toBe(false);
      expect(row.hasAttribute("aria-labelledby")).toBe(false);
      expect(row.textContent).toBe(
        `settings.connectionDevicesHome Mac${label}`
      );
      const presenceText = row.querySelector(
        ".mobile-settings__presence .sr-only"
      )!;
      expect(presenceText.textContent).toBe(label);
      expect(presenceText.closest('[aria-hidden="true"], [hidden]')).toBeNull();
      expect(
        row
          .querySelector(".mobile-settings__status-dot")
          ?.getAttribute("aria-hidden")
      ).toBe("true");
    }

    mocks.connection.desktopName = "";
    await render();
    expect(
      host.querySelector(".mobile-settings__desktop-name")?.textContent
    ).toBe("settings.notAvailable");
  });
  it("offers persisted system, light and dark appearance choices", async () => {
    await render();
    const appearance = host.querySelector(
      '[data-testid="mobile-remote-appearance-settings"]'
    )!;
    expect(appearance.textContent).toContain("settings.theme");
    const trigger = appearance.querySelector<HTMLElement>('[role="combobox"]');
    expect(trigger?.getAttribute("aria-label")).toBe("settings.theme");

    await act(async () => trigger?.click());
    const darkOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]')
    ).find((option) => option.textContent === "settings.themeDark");
    expect(darkOption).toBeTruthy();
    await act(async () => darkOption?.click());
    expect(mocks.setThemePreference).toHaveBeenCalledWith("dark");
  });
  it("opens device management from the entire connection row without mutating a pairing", async () => {
    const onOpenDevices = vi.fn();
    await render({ onOpenDevices });
    await click("settings.connectionDevicesHome Macsettings.online", host);
    expect(onOpenDevices).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("settings.revokePairing");
  });
  it("supports Profile/help in development bypass without fake account actions", async () => {
    mocks.bypass = true;
    await render();
    await click("mobile@example.test · profile.title", host);
    expect(dialog()?.textContent).toContain("profile.development");
    for (const key of [
      "settings.signOut",
      "settings.deleteAccount",
      "settings.manageAccount",
    ])
      expect(dialog()?.textContent).not.toContain(key);
    await click("profile.help");
    expect(dialog()?.textContent).toContain("profile.connectionHelp");
  });
  it("localizes protocol permissions", () => {
    expect(resolvePermissionTierLabel("full", (key) => key)).toBe(
      "settings.permissionFull"
    );
    expect(resolvePermissionTierLabel("read_only", (key) => key)).toBe(
      "settings.permissionReadOnly"
    );
  });
});
