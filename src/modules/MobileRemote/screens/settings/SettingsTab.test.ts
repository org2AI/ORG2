// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsTab, resolvePermissionTierLabel } from "./SettingsTab";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  navigate: vi.fn(),
  isDevelopmentBypass: false,
  connection: {
    status: "connected" as const,
    presence: "online" as const,
    desktopName: "Home Mac",
    tier: "full" as const,
    demoMode: false,
  },
}));
vi.mock("../../platform", () => ({
  useMobileRemotePlatform: () => ({ openExternal: mocks.navigate }),
}));

vi.mock("../../app", () => ({
  useMobileRemote: () => ({ connection: mocks.connection }),
}));

vi.mock("../../auth/MobileAuthContext", () => ({
  useMobileAuth: () => ({
    session: {
      userId: "user-a",
      profile: { primaryEmail: "mobile@example.test" },
    },
    signOut: mocks.signOut,
    isDevelopmentBypass: mocks.isDevelopmentBypass,
  }),
}));

const translations: Record<string, string> = {
  "settings.title": "Settings",
  "settings.account": "Account",
  "settings.signedInAs": "Signed in as",
  "settings.signOut": "Sign out",
  "settings.connection": "Connection",
  "settings.desktop": "Desktop",
  "settings.relay": "Relay",
  "settings.permissionTier": "Permission tier",
  "settings.permissionFull": "Full access",
  "settings.permissionReadOnly": "Read only",
  "settings.mode": "Mode",
  "settings.modeLive": "Live",
  "settings.help": "Help",
  "settings.pairingGuide": "Pairing guide",
  "settings.revokePairing": "Revoke pairing",
  "settings.online": "Online",
  "settings.notAvailable": "—",
  "settings.unknownRelay": "Not connected",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

describe("SettingsTab", () => {
  it("requires confirmation, supports cancel/Escape/mask, and closes before signing out once", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mocks.signOut.mockReset();
    try {
      await act(async () => root.render(React.createElement(SettingsTab)));
      const trigger = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent === "Sign out"
      )!;
      const open = async () => {
        trigger.focus();
        await act(async () => trigger.click());
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(mocks.signOut).not.toHaveBeenCalled();
      };
      await open();
      await act(async () => {
        Array.from(document.querySelectorAll('[role="dialog"] button'))
          .find((b) => b.textContent === "settings.cancel")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      await open();
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await open();
      await act(async () => {
        document
          .querySelector(".liquid-modal-mask")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await open();
      mocks.signOut.mockImplementation(() => {
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.style.overflow).toBe("");
      });
      const confirm = Array.from(
        document.querySelectorAll('[role="dialog"] button')
      ).find((b) => b.textContent === "Sign out") as HTMLButtonElement;
      await act(async () => {
        confirm.click();
        confirm.click();
      });
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
  it("opens shared account and privacy pages without credentials and permits retry after failure", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    mocks.navigate.mockReset();
    mocks.navigate.mockRejectedValueOnce(new Error("open failed"));
    try {
      await act(async () => {
        root.render(React.createElement(SettingsTab));
      });
      const click = async (label: string) => {
        await act(async () => {
          Array.from(host.querySelectorAll("button"))
            .find((button) => button.textContent === label)!
            .click();
        });
      };
      await click("settings.manageAccount");
      expect(host.textContent).toContain("settings.openFailed");
      mocks.navigate.mockResolvedValue(undefined);
      await click("settings.deleteAccount");
      expect(host.textContent).not.toContain("settings.openFailed");
      await click("settings.privacyPolicy");
      expect(mocks.navigate.mock.calls.map(([url]) => url)).toEqual([
        "https://org2-cloud-infra.vercel.app/account",
        "https://org2-cloud-infra.vercel.app/account",
        "https://org2-cloud-infra.vercel.app/legal/privacy",
      ]);
    } finally {
      await act(async () => root.unmount());
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.isDevelopmentBypass = false;
    localStorage.clear();
    localStorage.setItem(
      "orgii-mobile-remote-config:user:user-a",
      JSON.stringify({ wsUrl: "wss://relay.example.test/v1/mobile/ws" })
    );
  });

  it("uses shared section rows and localizes protocol permission values", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsTab));

    expect(html).toContain('data-testid="mobile-remote-connection-settings"');
    expect(html).toContain('data-testid="mobile-remote-account-settings"');
    expect(html).toContain("mobile@example.test");
    expect(html).toContain("section-layout-row");
    expect(html).toContain("flex-row justify-between gap-4");
    expect(html).toContain("flex min-w-0 items-center flex-1");
    expect(html).toContain("block w-full min-w-0 truncate text-right");
    expect(html).toContain("Home Mac · Online");
    expect(html).toContain("Full access");
    expect(html).not.toContain(">full<");
    expect(html).not.toContain("Revoke pairing");
  });

  it("only renders help actions when the owning behavior is supplied", () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsTab, {
        onOpenPairingGuide: vi.fn(),
        onRevokePairing: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="mobile-remote-help-settings"');
    expect(html).toContain("Pairing guide");
    expect(html).toContain("Revoke pairing");
    expect(html.match(/<button/g)).toHaveLength(6);
    expect(html).toContain("settings.manageAccount");
    expect(html).toContain("settings.deleteAccount");
    expect(html).toContain("settings.privacyPolicy");
  });

  it("does not render a non-functional sign-out action for the development bypass", () => {
    mocks.isDevelopmentBypass = true;

    const html = renderToStaticMarkup(React.createElement(SettingsTab));

    expect(html).toContain("mobile@example.test");
    expect(html).not.toContain("Sign out");
  });

  it("maps both wire permission tiers to presentation copy", () => {
    const t = (key: string) => translations[key] ?? key;
    expect(resolvePermissionTierLabel("full", t)).toBe("Full access");
    expect(resolvePermissionTierLabel("read_only", t)).toBe("Read only");
  });
});
