// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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

import { ConnectionDevicesScreen } from "./ConnectionDevicesScreen";

const mocks = vi.hoisted(() => ({
  switchPairedDesktop: vi.fn(),
  presence: "online",
  empty: false,
  activeDesktopId: "desktop-1",
}));
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

vi.mock("../../app", () => ({
  useMobileRemote: () => ({
    connection: {
      desktopId: mocks.activeDesktopId,
      desktopName: "Home Mac",
      presence: mocks.presence,
      tier: "read_only",
    },
    pairedDesktops: mocks.empty
      ? []
      : [
          {
            id: "desktop-1",
            name: "Home Mac",
            desktopIdentity: {
              name: "Home Mac",
              model: "Mac14,7",
              username: "alex",
            },
            active: mocks.activeDesktopId === "desktop-1",
            updatedAtMs: 1,
          },
          {
            id: "desktop-2",
            name: "Office Mac",
            active: mocks.activeDesktopId === "desktop-2",
            updatedAtMs: 2,
          },
        ],
    switchPairedDesktop: mocks.switchPairedDesktop,
  }),
}));

const translations: Record<string, string> = {
  "devices.title": "Devices",
  "devices.thisDevice": "This device",
  "devices.thisDeviceLabel": "ORG2 Mobile",
  "devices.pairedDesktops": "Paired desktops",
  "devices.primary": "Primary",
  "devices.currentDesktop": "Current computer",
  "devices.presenceUnknown": "Status unknown",
  "devices.online": "Online",
  "devices.offline": "Offline",
  "devices.unknown": "Connecting",
  "devices.switchTo": "Switch to Office Mac",
  "devices.switchFailed": "Could not switch desktops",
  "devices.emptyDesktops": "No paired desktops",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

describe("ConnectionDevicesScreen", () => {
  beforeEach(() => {
    mocks.presence = "online";
    mocks.empty = false;
    mocks.activeDesktopId = "desktop-1";
  });
  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(() => {
    mocks.switchPairedDesktop.mockReset();
  });

  it("uses shared section rows, icons, and status presentation", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionDevicesScreen, {
        onBack: vi.fn(),
        onAddDesktop: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="mobile-remote-this-device"');
    expect(html).toContain('data-testid="mobile-remote-paired-desktops"');
    expect(html).toContain("section-layout-row");
    expect(html).toContain("Home Mac");
    expect(html).toContain("settings.permissionReadOnly");
    expect(html).not.toContain("Full remote · Active now");
    expect(html).toContain("Mac14,7 · alex");
    expect(html).toContain("Current computer");
    expect(html).toContain("Online");
    expect(html).toContain("bg-success-6");
  });

  it("keeps Add computer available with no paired desktops", () => {
    mocks.empty = true;
    const html = renderToStaticMarkup(
      React.createElement(ConnectionDevicesScreen, {
        onBack: vi.fn(),
        onAddDesktop: vi.fn(),
      })
    );
    expect(html).toContain("No paired desktops");
    expect(html).toContain("devices.addDesktop");
  });

  it("keeps unobserved desktops unknown without a connecting animation", () => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectionDevicesScreen, {
        onBack: vi.fn(),
        onAddDesktop: vi.fn(),
      })
    );
    expect(html).toContain("Status unknown");
    expect(html).not.toContain("Offline");
    expect(html).not.toContain("animate-pulse");
  });

  it("routes an inactive desktop row through the shared switch action", async () => {
    mocks.switchPairedDesktop.mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button[aria-busy]")
      ).find((candidate) => candidate.textContent?.includes("Office Mac"));
      expect(button).toBeTruthy();
      act(() => button?.click());
      expect(mocks.switchPairedDesktop).toHaveBeenCalledWith("desktop-2");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("locks switch controls while keeping the current computer readable", async () => {
    let resolveSwitch!: () => void;
    const pendingSwitch = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    mocks.switchPairedDesktop.mockReturnValue(pendingSwitch);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      const officeButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Switch to Office Mac"]'
      );
      expect(officeButton).toBeTruthy();

      act(() => officeButton?.click());

      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button[aria-busy]")
      );
      expect(buttons).toHaveLength(1);
      expect(buttons.every((button) => button.disabled)).toBe(true);
      expect(officeButton?.getAttribute("aria-busy")).toBe("true");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      const current = container.querySelector('[aria-current="true"]');
      expect(current?.textContent).toContain("Home Mac");
      expect(current?.textContent).toContain("Current computer");
      expect(current?.closest("button")).toBeNull();
      expect(current?.textContent).toContain("Mac14,7 · alex");

      await act(async () => {
        resolveSwitch();
        await pendingSwitch;
      });
      expect(officeButton?.disabled).toBe(false);
      expect(officeButton?.getAttribute("aria-busy")).toBe("false");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("shows an inline error and restores the inactive row after switching fails", async () => {
    mocks.switchPairedDesktop.mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      const officeButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Switch to Office Mac"]'
      );

      await act(async () => {
        officeButton?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.switchPairedDesktop).toHaveBeenCalledWith("desktop-2");
      expect(officeButton?.disabled).toBe(false);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Could not switch desktops"
      );
      mocks.switchPairedDesktop.mockResolvedValue(undefined);
      await act(async () => officeButton?.click());
      expect(mocks.switchPairedDesktop).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("moves the current marker and live presence when selection changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      expect(
        container.querySelector('[aria-current="true"]')?.textContent
      ).toContain("Home Mac");

      mocks.activeDesktopId = "desktop-2";
      mocks.presence = "unknown";
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      expect(
        container.querySelector('[aria-current="true"]')?.textContent
      ).toContain("Office Mac");
      expect(container.textContent).toContain("Connecting");
      expect(container.textContent).toContain("Status unknown");
      expect(container.textContent).not.toContain("Online");

      mocks.presence = "online";
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      expect(container.textContent).toContain("Online");
      expect(container.textContent).not.toContain("Connecting");

      mocks.presence = "offline";
      await act(async () =>
        root.render(
          React.createElement(ConnectionDevicesScreen, {
            onBack: vi.fn(),
            onAddDesktop: vi.fn(),
          })
        )
      );
      expect(container.textContent).toContain("Offline");
      expect(container.textContent).toContain("Status unknown");
      expect(
        container.querySelector('[aria-current="true"]')?.textContent
      ).toContain("Office Mac");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
