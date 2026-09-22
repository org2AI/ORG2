// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileRemotePlatform } from "../platform";
import { MobileThemeProvider, useMobileTheme } from "./MobileThemeContext";

const TestMobileThemeProvider = MobileThemeProvider as React.ComponentType<
  React.PropsWithChildren<
    Omit<React.ComponentProps<typeof MobileThemeProvider>, "children">
  >
>;

const env = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("MobileThemeProvider", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let previousAct: boolean | undefined;

  beforeEach(() => {
    previousAct = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    env.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });

  it("keeps mobile persistence and reload hydration isolated from Desktop", async () => {
    localStorage.setItem("theme", "dark");
    const readPreference = vi.fn((key: string) => localStorage.getItem(key));
    const writePreference = vi.fn((key: string, value: string) =>
      localStorage.setItem(key, value)
    );
    const applyColorScheme = vi.fn();
    const platform = {
      runtime: {
        readPreference,
        writePreference,
        isHidden: () => false,
        subscribeVisibility: () => () => undefined,
      },
      appearance: {
        getSystemColorScheme: () => "light",
        subscribeSystemColorScheme: () => () => undefined,
        applyColorScheme,
      },
    } as unknown as MobileRemotePlatform;
    function Probe() {
      const theme = useMobileTheme();
      return React.createElement(
        "button",
        {
          "data-preference": theme.preference,
          onClick: () => void theme.setPreference("dark"),
        },
        theme.resolvedColorScheme
      );
    }
    const render = async () => {
      await act(async () => {
        root.render(
          React.createElement(
            TestMobileThemeProvider,
            { platform },
            React.createElement(Probe)
          )
        );
      });
    };

    await render();
    expect(host.firstElementChild?.getAttribute("data-preference")).toBe(
      "system"
    );
    expect(host.textContent).toBe("light");
    expect(applyColorScheme).toHaveBeenLastCalledWith("light");
    expect(readPreference).toHaveBeenCalledWith("mobileRemote.theme");
    expect(readPreference).not.toHaveBeenCalledWith("theme");

    // A user choice must not change Desktop's conflicting saved preference.
    localStorage.setItem("theme", "light");
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(localStorage.getItem("mobileRemote.theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(writePreference).toHaveBeenCalledExactlyOnceWith(
      "mobileRemote.theme",
      "dark"
    );

    await act(async () => root.unmount());
    root = createRoot(host);
    // Desktop may sync its own preference while the mobile view is closed.
    localStorage.setItem("theme", "system");
    await render();
    expect(host.firstElementChild?.getAttribute("data-preference")).toBe(
      "dark"
    );
    expect(host.textContent).toBe("dark");
    expect(applyColorScheme).toHaveBeenLastCalledWith("dark");
    expect(localStorage.getItem("theme")).toBe("system");
  });

  it("persists explicit choices and only follows OS changes in system mode", async () => {
    let systemColorScheme: "light" | "dark" = "light";
    let systemListener: ((scheme: "light" | "dark") => void) | undefined;
    let visibilityListener: (() => void) | undefined;
    const writePreference = vi.fn();
    const applyColorScheme = vi.fn();
    const unsubscribeSystem = vi.fn();
    const unsubscribeVisibility = vi.fn();
    const platform = {
      runtime: {
        readPreference: () => "system",
        writePreference,
        isHidden: () => false,
        subscribeVisibility: (listener: () => void) => {
          visibilityListener = listener;
          return unsubscribeVisibility;
        },
      },
      appearance: {
        getSystemColorScheme: () => systemColorScheme,
        subscribeSystemColorScheme: (
          listener: (scheme: "light" | "dark") => void
        ) => {
          systemListener = listener;
          return unsubscribeSystem;
        },
        applyColorScheme,
      },
    } as unknown as MobileRemotePlatform;
    function Probe() {
      const theme = useMobileTheme();
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "span",
          {
            "data-testid": "theme-state",
            "data-preference": theme.preference,
            "data-status": theme.status,
          },
          theme.resolvedColorScheme
        ),
        React.createElement(
          "button",
          { onClick: () => void theme.setPreference("dark") },
          "dark"
        ),
        React.createElement(
          "button",
          { onClick: () => void theme.setPreference("system") },
          "system"
        )
      );
    }

    await act(async () => {
      root.render(
        React.createElement(
          TestMobileThemeProvider,
          { platform },
          React.createElement(Probe)
        )
      );
    });
    expect(applyColorScheme).toHaveBeenLastCalledWith("light");
    expect(systemListener).toBeTypeOf("function");
    expect(visibilityListener).toBeTypeOf("function");

    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click()
    );
    expect(writePreference).toHaveBeenCalledWith("mobileRemote.theme", "dark");
    expect(applyColorScheme).toHaveBeenLastCalledWith("dark");

    applyColorScheme.mockClear();
    systemColorScheme = "dark";
    await act(async () => systemListener?.("dark"));
    expect(applyColorScheme).not.toHaveBeenCalled();

    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>("button")[1]!.click()
    );
    expect(applyColorScheme).toHaveBeenLastCalledWith("dark");
    applyColorScheme.mockClear();
    systemColorScheme = "light";
    await act(async () => visibilityListener?.());
    expect(applyColorScheme).toHaveBeenCalledTimes(1);
    expect(applyColorScheme).toHaveBeenCalledWith("light");

    await act(async () => root.unmount());
    root = createRoot(host);
    expect(unsubscribeSystem).toHaveBeenCalledTimes(1);
    expect(unsubscribeVisibility).toHaveBeenCalledTimes(1);
  });

  it("keeps the active preference when persistence fails", async () => {
    const applyColorScheme = vi.fn();
    const platform = {
      runtime: {
        readPreference: () => "light",
        writePreference: () => {
          throw new Error("storage unavailable");
        },
        isHidden: () => false,
        subscribeVisibility: () => () => undefined,
      },
      appearance: {
        getSystemColorScheme: () => "dark",
        subscribeSystemColorScheme: () => () => undefined,
        applyColorScheme,
      },
    } as unknown as MobileRemotePlatform;
    function Probe() {
      const theme = useMobileTheme();
      return React.createElement(
        React.Fragment,
        null,
        React.createElement("span", {
          "data-testid": "theme-state",
          "data-preference": theme.preference,
          "data-status": theme.status,
        }),
        React.createElement(
          "button",
          { onClick: () => void theme.setPreference("dark") },
          "dark"
        )
      );
    }

    await act(async () => {
      root.render(
        React.createElement(
          TestMobileThemeProvider,
          { platform },
          React.createElement(Probe)
        )
      );
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click()
    );

    const state = host.querySelector<HTMLElement>(
      '[data-testid="theme-state"]'
    )!;
    expect(state.dataset.preference).toBe("light");
    expect(state.dataset.status).toBe("error");
    expect(applyColorScheme).toHaveBeenCalledTimes(1);
    expect(applyColorScheme).toHaveBeenCalledWith("light");
  });

  it("does not let a late startup failure overwrite a newer applied choice", async () => {
    let rejectStartup!: (error: Error) => void;
    const startup = new Promise<void>((_resolve, reject) => {
      rejectStartup = reject;
    });
    const applyColorScheme = vi
      .fn()
      .mockReturnValueOnce(startup)
      .mockResolvedValue(undefined);
    const platform = {
      runtime: {
        readPreference: () => "light",
        writePreference: vi.fn(),
        isHidden: () => false,
        subscribeVisibility: () => () => undefined,
      },
      appearance: {
        getSystemColorScheme: () => "light",
        subscribeSystemColorScheme: () => () => undefined,
        applyColorScheme,
      },
    } as unknown as MobileRemotePlatform;
    function Probe() {
      const theme = useMobileTheme();
      return React.createElement(
        "button",
        {
          "data-status": theme.status,
          onClick: () => void theme.setPreference("dark"),
        },
        theme.resolvedColorScheme
      );
    }
    await act(async () => {
      root.render(
        React.createElement(
          TestMobileThemeProvider,
          { platform },
          React.createElement(Probe)
        )
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(host.textContent).toBe("dark");
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("idle");
    await act(async () => {
      rejectStartup(new Error("late native failure"));
    });
    expect(host.textContent).toBe("dark");
    expect(host.firstElementChild?.getAttribute("data-status")).toBe("idle");
  });
});
