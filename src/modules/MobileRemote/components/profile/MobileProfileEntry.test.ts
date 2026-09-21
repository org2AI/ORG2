// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MobileAuthContext,
  type MobileAuthContextValue,
} from "../../auth/MobileAuthContext";
import { SessionsScreen } from "../../screens/SessionsScreen";
import { WelcomeScreen } from "../../screens/WelcomeScreen";
import { MobileProfileEntry } from "./MobileProfileEntry";

const mocks = vi.hoisted(() => ({ openExternal: vi.fn(), select: vi.fn() }));
vi.mock("../../platform", () => ({
  useMobileRemotePlatform: () => ({
    openExternal: mocks.openExternal,
    runtime: {
      isHidden: () => false,
      subscribeVisibility: () => () => {},
    },
  }),
}));
vi.mock("../../app", () => ({
  useMobileRemote: () => ({
    connection: {
      status: "connected",
      presence: "online",
      desktopName: "Home Mac",
    },
    sessions: [
      { id: "codexapp-one", name: "Keep this session", status: "idle" },
    ],
    sessionsHasMore: false,
    loadMoreSessions: vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let auth: MobileAuthContextValue;
const env = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousAct: boolean | undefined;

async function render(welcome = false) {
  const profileAction = React.createElement(MobileProfileEntry);
  await act(async () =>
    root.render(
      React.createElement(
        MobileAuthContext.Provider,
        { value: auth },
        welcome
          ? React.createElement(WelcomeScreen, { profileAction })
          : React.createElement(SessionsScreen, {
              profileAction,
              onSelectSession: mocks.select,
            })
      )
    )
  );
}
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
async function open() {
  button("profile.open", host).focus();
  await click("profile.open", host);
  await act(async () => vi.advanceTimersByTime(100));
}

beforeEach(() => {
  previousAct = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  // Keep React/jsdom microtasks real; only count application timeout/interval work.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  mocks.openExternal.mockReset().mockResolvedValue(undefined);
  mocks.select.mockReset();
  auth = {
    session: {
      kind: "org2_cloud",
      supabaseUrl: "https://cloud.example.test",
      supabaseAnonKey: "anon",
      userId: "private-user-id",
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      expiresAt: 2_000_000_000,
      profile: {
        displayName: "Ada Lovelace",
        primaryEmail: "ada@example.test",
        avatarUrl: "https://images.example.test/ada.png",
      },
    },
    signOut: vi.fn(),
    isDevelopmentBypass: false,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  // jsdom schedules selectionchange at 0 ms when focus moves. Drain only that
  // browser bookkeeping, not Modal's 100 ms focus timer, which must be cancelled.
  await act(async () => vi.advanceTimersByTime(1));
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    env.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});

describe("mobile Profile entry", () => {
  it("names the Settings row with the current account and restores its focus after closing", async () => {
    const renderRow = async () =>
      act(async () =>
        root.render(
          React.createElement(
            MobileAuthContext.Provider,
            { value: auth },
            React.createElement(MobileProfileEntry, { variant: "row" })
          )
        )
      );
    await renderRow();
    const trigger = button("Ada Lovelace · profile.title", host);
    expect(trigger.textContent).toContain("Ada Lovelace");
    expect(trigger.textContent).toContain("profile.title");
    await act(async () => trigger.click());
    await act(async () => vi.advanceTimersByTime(100));
    await click("profile.close");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    auth = {
      ...auth,
      session: {
        ...auth.session,
        profile: {
          ...auth.session.profile,
          displayName: "",
          primaryEmail: "updated@example.test",
        },
      },
    };
    await renderRow();
    expect(button("updated@example.test · profile.title", host)).toBe(trigger);
    expect(trigger.getAttribute("aria-label")).not.toContain("Ada Lovelace");
  });

  it.each([false, true])(
    "keeps the full avatar inside a circular shared Button in the %s welcome slot",
    async (welcome) => {
      await render(welcome);
      const trigger = button("profile.open", host);
      // Inspect the real Button's inline geometry and content wrappers. jsdom
      // cannot measure WebKit layout, but catches the desktop defaults that
      // overrode the mobile CSS and the label wrapper that clipped the avatar.
      expect(trigger.classList.contains("button")).toBe(true);
      expect(trigger.type).toBe("button");
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger.style.width).toBe("var(--mobile-profile-trigger-size)");
      expect(trigger.style.height).toBe("var(--mobile-profile-trigger-size)");
      expect(trigger.style.borderRadius).toBe("50%");
      expect(trigger.style.padding).toBe(
        "var(--mobile-profile-trigger-padding)"
      );
      const styles = readFileSync(
        "src/modules/MobileRemote/components/profile/mobileProfile.scss",
        "utf8"
      );
      const geometry = styles.match(
        /\.mobile-profile-trigger\s*\{([^}]+)\}/
      )?.[1];
      expect(geometry).toContain("--mobile-profile-trigger-size: 48px");
      expect(geometry).toContain("--mobile-profile-trigger-padding: 3px");
      expect(trigger.querySelector(".truncate")).toBeNull();
      const avatar = trigger.querySelector<HTMLElement>(".rounded-full")!;
      expect(avatar.style.width).toBe("40px");
      expect(avatar.style.height).toBe("40px");
      expect(avatar.classList.contains("shrink-0")).toBe(true);
      expect(avatar.closest('[aria-hidden="true"]')).not.toBeNull();
      const photo = avatar.querySelector("img")!;
      expect(photo.getAttribute("src")).toBe(
        "https://images.example.test/ada.png"
      );
      expect(photo.getAttribute("alt")).toBe("");
      expect(photo.classList.contains("object-cover")).toBe(true);

      if (!welcome) {
        const header = trigger.closest("header")!;
        expect(header.classList.contains("mobile-top-bar--root")).toBe(true);
        expect(header.children[0].contains(trigger)).toBe(true);
        expect(header.children[1].tagName).toBe("H1");
        expect(header.children[1].textContent).toBe("tabs.sessions");
        expect(header.children[2].querySelector("button")?.ariaLabel).toBe(
          "sessions.viewOptions"
        );
      }

      await act(async () => photo.dispatchEvent(new Event("error")));
      expect(trigger.querySelector("img")).toBeNull();
      expect(trigger.textContent).toBe("A");
      expect(trigger.querySelector(".truncate")).toBeNull();
      expect(
        trigger.querySelector<HTMLElement>(".rounded-full")?.style.height
      ).toBe("40px");
      await open();
      expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
      await click("profile.close");
      expect(document.activeElement).toBe(trigger);
    }
  );

  it.each([false, true])(
    "opens from the %s welcome slot without starting navigation",
    async (welcome) => {
      await render(welcome);
      expect(dialog()).toBeNull();
      await open();
      expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
      expect(dialog()?.textContent).toContain("Ada Lovelace");
      expect(dialog()?.textContent).toContain("ada@example.test");
      expect(dialog()?.textContent).not.toContain("private-user-id");
      expect(dialog()?.innerHTML).not.toMatch(/secret-access|secret-refresh/);
      expect(document.activeElement).toBe(button("profile.close"));
      expect(mocks.openExternal).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
      await click("profile.close");
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(button("profile.open", host));
      if (!welcome) expect(host.textContent).toContain("Keep this session");
    }
  );

  it("supports help/back, Escape, mask close and repeated open/close without retained timers", async () => {
    await render();
    for (let index = 0; index < 3; index += 1) {
      await open();
      await click("profile.help");
      expect(dialog()?.textContent).toContain("profile.pairingStep1");
      await click("profile.back");
      expect(dialog()?.textContent).toContain("Ada Lovelace");
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        )
      );
      expect(dialog()).toBeNull();
      expect(document.body.style.overflow).toBe("");
      await act(async () => vi.advanceTimersByTime(1));
      expect(vi.getTimerCount()).toBe(0);
    }
    await open();
    await act(async () =>
      document
        .querySelector(".liquid-modal-mask")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(dialog()).toBeNull();
  });

  it("traps keyboard focus within the profile", async () => {
    await render();
    await open();
    const first = button("profile.close");
    const last = button("settings.deleteAccount");
    last.focus();
    await act(async () =>
      last.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(first);
    await act(async () =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        })
      )
    );
    expect(document.activeElement).toBe(last);
  });

  it("moves focus from the removed Help row to Back and keeps Tab within Help", async () => {
    await render();
    await open();
    button("profile.help").focus();
    await click("profile.help");
    const back = button("profile.back");
    expect(document.activeElement).toBe(back);
    for (const shiftKey of [false, true]) {
      await act(async () =>
        back.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey,
            bubbles: true,
          })
        )
      );
      expect(document.activeElement).toBe(back);
    }
    expect(dialog()?.textContent).toContain("profile.pairingStep1");
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("cancels initial focus when closed immediately and preserves the next overlay", async () => {
    await render();
    // Settle the closed session-menu positioning frame before measuring the
    // profile overlay's own timer cleanup.
    await act(async () => vi.advanceTimersByTime(20));
    const trigger = button("profile.open", host);
    trigger.focus();
    await click("profile.open", host);
    expect(dialog()).not.toBeNull();
    // Close before Modal's deferred initial-focus callback can run.
    await click("profile.close");
    await act(async () => vi.advanceTimersByTime(1));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
    expect(vi.getTimerCount()).toBe(0);

    await open();
    expect(document.activeElement).toBe(button("profile.close"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("reuses the confirmation dialog and signs out once only after overlay cleanup", async () => {
    await render();
    await open();
    await click("settings.signOut");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()?.getAttribute("aria-label")).toBe(
      "settings.signOutConfirmTitle"
    );
    expect(auth.signOut).not.toHaveBeenCalled();
    await click("settings.cancel");
    expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
    await click("settings.signOut");
    vi.mocked(auth.signOut).mockImplementation(() => {
      expect(dialog()).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
    const confirm = button("settings.signOut");
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("opens only official credential-free pages, exposes failure, and allows retry", async () => {
    mocks.openExternal.mockRejectedValueOnce(new Error("secret server detail"));
    await render();
    await open();
    await click("settings.manageAccount");
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain(
      "settings.openFailed"
    );
    expect(dialog()?.textContent).not.toContain("secret server detail");
    await click("settings.privacyPolicy");
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
    await click("profile.terms");
    await click("settings.deleteAccount");
    expect(mocks.openExternal.mock.calls.map(([url]) => url)).toEqual([
      "https://org2-cloud-infra.vercel.app/account",
      "https://org2-cloud-infra.vercel.app/legal/privacy",
      "https://org2-cloud-infra.vercel.app/legal/terms",
      "https://org2-cloud-infra.vercel.app/account",
    ]);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("profile.deleteHint");
  });

  it("single-flights navigation and ignores a failed completion after close/reopen", async () => {
    let reject!: (error: Error) => void;
    mocks.openExternal.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    await render();
    await open();
    const manage = button("settings.manageAccount");
    await act(async () => {
      manage.click();
      manage.click();
    });
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    expect(button("settings.privacyPolicy").disabled).toBe(true);
    expect(dialog()?.querySelector('[role="status"]')).not.toBeNull();
    await click("profile.close");
    await open();
    await act(async () => reject(new Error("late failure")));
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
    expect(button("settings.manageAccount").disabled).toBe(false);
    await click("settings.manageAccount");
    expect(mocks.openExternal).toHaveBeenCalledTimes(2);
  });

  it("clears old account intent and profile when identity changes", async () => {
    await render();
    await open();
    await click("settings.signOut");
    const oldSignOut = auth.signOut;
    auth = {
      ...auth,
      session: {
        ...auth.session,
        userId: "other",
        profile: { displayName: "Grace" },
      },
      signOut: vi.fn(),
    };
    await render();
    expect(dialog()).toBeNull();
    await open();
    expect(dialog()?.textContent).toContain("Grace");
    expect(dialog()?.textContent).not.toContain("Ada Lovelace");
    expect(oldSignOut).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "isolates the same user's new endpoint from a pending old request that will %s",
    async (outcome) => {
      let settle!: () => void;
      mocks.openExternal.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            settle = () =>
              outcome === "resolve"
                ? resolve()
                : reject(new Error("old endpoint failure"));
          })
      );
      await render();
      await open();
      await click("settings.manageAccount");
      expect(button("settings.manageAccount").disabled).toBe(true);

      auth = {
        ...auth,
        session: {
          ...auth.session,
          supabaseUrl: "https://other-cloud.example.test",
          profile: { displayName: "New endpoint profile" },
        },
      };
      await render();
      expect(dialog()).toBeNull();
      expect(document.body.style.overflow).toBe("");
      await open();
      expect(dialog()?.textContent).toContain("New endpoint profile");
      expect(dialog()?.textContent).not.toContain("Ada Lovelace");
      expect(button("settings.manageAccount").disabled).toBe(false);

      await act(async () => settle());
      expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
      expect(dialog()?.querySelector('[role="status"]')).toBeNull();
      await click("settings.manageAccount");
      expect(mocks.openExternal).toHaveBeenCalledTimes(2);
      expect(auth.signOut).not.toHaveBeenCalled();
    }
  );

  it.each([
    "not a URL",
    "/avatar.png",
    "http://images.example.test/ada.png",
    "javascript:alert(1)",
    "data:image/png;base64,aGVsbG8=",
    "https://username:password@images.example.test/ada.png",
    "https://username@images.example.test/ada.png",
  ])("never renders an unsafe profile photo: %s", async (avatarUrl) => {
    auth = {
      ...auth,
      session: {
        ...auth.session,
        profile: { ...auth.session.profile, avatarUrl },
      },
    };
    await render();
    const trigger = button("profile.open", host);
    expect(trigger.querySelector("img")).toBeNull();
    expect(trigger.textContent).toBe("A");
    await open();
    expect(dialog()?.querySelector("img")).toBeNull();
    expect(dialog()?.textContent).toContain("Ada Lovelace");
    expect(dialog()?.innerHTML).not.toContain(avatarUrl);
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("shows a safe initial for missing or failed photos and retries a changed photo", async () => {
    await render();
    const trigger = button("profile.open", host);
    await act(async () =>
      trigger.querySelector("img")!.dispatchEvent(new Event("error"))
    );
    expect(trigger.querySelector("img")).toBeNull();
    expect(trigger.textContent).toBe("A");
    auth = {
      ...auth,
      session: {
        ...auth.session,
        profile: {
          ...auth.session.profile,
          avatarUrl: "https://images.example.test/new.png",
        },
      },
    };
    await render();
    expect(trigger.querySelector("img")?.getAttribute("src")).toContain(
      "new.png"
    );
    auth = { ...auth, session: { ...auth.session, profile: undefined } };
    await render();
    await open();
    expect(dialog()?.textContent).toContain("profile.fallbackName");
    expect(dialog()?.textContent).not.toContain("private-user-id");
  });

  it("does not offer fake account actions in development bypass", async () => {
    auth = { ...auth, isDevelopmentBypass: true };
    await render();
    await open();
    expect(dialog()?.textContent).toContain("profile.development");
    expect(dialog()?.textContent).not.toContain("settings.signOut");
    expect(dialog()?.textContent).not.toContain("settings.deleteAccount");
    expect(dialog()?.textContent).not.toContain("settings.manageAccount");
    await click("profile.help");
    expect(dialog()?.textContent).toContain("profile.connectionHelp");
  });
});
