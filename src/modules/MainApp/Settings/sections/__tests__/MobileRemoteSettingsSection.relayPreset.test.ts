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

import {
  type PairedDeviceInfo,
  type PairingInitOutput,
  type RelayStatus,
  mobileRemoteApi,
} from "@src/api/tauri/mobileRemote";
import Message from "@src/components/Message";
import {
  MOBILE_REMOTE_RELAY_LOCAL_URL,
  MOBILE_REMOTE_RELAY_PRODUCTION_URL,
} from "@src/config/mobileRemoteRelay";

import MobileRemoteSettingsSection from "../MobileRemoteSettingsSection";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const mocks = vi.hoisted(() => ({
  cloudAuth: null as {
    userId: string;
    profile?: { displayName?: string; primaryEmail?: string };
  } | null,
  cloudSignIn: vi.fn(async () => true),
  settings: new Map<string, unknown>(),
  setRelayUrl: vi.fn(),
  saveSettings: vi.fn(),
  relayStatus: null as RelayStatus | null,
  relayStatusLoading: false,
  relayStatusError: null as string | null,
  refreshRelayStatus: vi.fn(),
  manualRefreshRequired: false,
  setRelayEnabled: vi.fn(),
  devices: [] as PairedDeviceInfo[],
  devicesLoading: false,
  devicesError: null as string | null,
  refreshDevices: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { identity?: string }) => {
      if (values?.identity != null) {
        return `${key}:${values.identity}`;
      }
      return key;
    },
  }),
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useAtomValue: () =>
      mocks.cloudAuth
        ? {
            supabaseUrl: "https://cloud.example.test",
            ...mocks.cloudAuth,
          }
        : null,
    useSetAtom: () => mocks.saveSettings,
  };
});

vi.mock("@src/features/Org2Cloud/useOrg2CloudSignIn", () => ({
  useOrg2CloudSignIn: () => mocks.cloudSignIn,
}));

vi.mock("@src/api/tauri/mobileRemote", () => ({
  mobileRemoteApi: {
    getRelayStatus: vi.fn(),
    notifyCloudAuthChanged: vi.fn(),
    pairComplete: vi.fn(),
    pairInit: vi.fn(),
    revokeDevice: vi.fn(),
    syncDevices: vi.fn(),
  },
  PERMISSION_TIER: { FULL: "full", READ_ONLY: "read_only" },
}));

vi.mock("@src/components/Message", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@src/hooks/settings/useSettings", () => ({
  useSetting: (key: string) => {
    if (key === "mobileRemote.relayEnabled") {
      return [mocks.settings.get(key), mocks.setRelayEnabled];
    }
    if (key === "mobileRemote.relayUrl") {
      return [mocks.settings.get(key), mocks.setRelayUrl];
    }
    return [mocks.settings.get(key), vi.fn()];
  },
}));

vi.mock("@src/hooks/async/useAsyncData", () => ({
  useAsyncData: <T>({ initialData }: { initialData: T }) => ({
    data: Array.isArray(initialData) ? mocks.devices : initialData,
    error: mocks.devicesError,
    loading: mocks.devicesLoading,
    refresh: mocks.refreshDevices,
  }),
}));

vi.mock("../useMobileRelayStatus", () => ({
  useMobileRelayStatus: () => ({
    data: mocks.relayStatus,
    loading: mocks.relayStatusLoading,
    error: mocks.relayStatusError,
    refresh: mocks.refreshRelayStatus,
    manualRefreshRequired: mocks.manualRefreshRequired,
  }),
}));

function findPresetButton(
  container: HTMLElement,
  label: string
): HTMLButtonElement {
  const group = container.querySelector(
    '[data-testid="mobile-remote-relay-preset"]'
  );
  const button = Array.from(group?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing preset button: ${label}`);
  }
  return button;
}

describe("MobileRemoteSettingsSection relay preset switcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.cloudAuth = null;
    mocks.cloudSignIn.mockReset();
    mocks.settings.clear();
    mocks.settings.set("mobileRemote.enabled", true);
    mocks.settings.set("mobileRemote.relayEnabled", true);
    mocks.settings.set(
      "mobileRemote.relayUrl",
      MOBILE_REMOTE_RELAY_PRODUCTION_URL
    );
    mocks.settings.set("mobileRemote.allowLanExposure", false);
    mocks.settings.set("mobileRemote.lanToken", "lan-token");
    mocks.settings.set("mobileRemote.lanPort", 13847);
    mocks.setRelayUrl.mockReset();
    mocks.setRelayEnabled.mockReset().mockImplementation((next) => {
      mocks.settings.set("mobileRemote.relayEnabled", next);
    });
    mocks.relayStatus = null;
    mocks.relayStatusLoading = false;
    mocks.relayStatusError = null;
    mocks.manualRefreshRequired = false;
    mocks.refreshRelayStatus.mockReset();
    mocks.devices = [];
    mocks.devicesLoading = false;
    mocks.devicesError = null;
    mocks.refreshDevices.mockReset();
    mocks.saveSettings.mockReset().mockImplementation(async (updates) => {
      for (const [key, value] of Object.entries(updates))
        mocks.settings.set(key, value);
    });
    vi.mocked(mobileRemoteApi.notifyCloudAuthChanged).mockReset();
    vi.mocked(mobileRemoteApi.pairInit).mockReset();
    vi.mocked(mobileRemoteApi.pairComplete).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  async function renderSection(): Promise<void> {
    await act(async () => {
      root.render(createElement(MobileRemoteSettingsSection));
    });
  }

  function clickText(label: string): void {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    act(() => button.click());
  }

  function findButtonByLabel(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === label
    );
    if (!button) throw new Error(`Missing button label: ${label}`);
    return button;
  }

  function clickLabel(label: string): void {
    act(() => findButtonByLabel(label).click());
  }

  function openAdvanced(): void {
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="mobile-remote-advanced-toggle"]'
        )
        ?.click()
    );
  }

  it("hides relay configuration by default and preserves custom settings across disclosure", async () => {
    mocks.settings.set(
      "mobileRemote.relayUrl",
      "wss://custom.example.test/v1/mobile/ws"
    );
    await renderSection();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("mobileRemote.outdoorTitle");
    openAdvanced();
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
      "wss://custom.example.test/v1/mobile/ws"
    );
    expect(
      container.querySelector('[data-testid="mobile-remote-relay-preset"]')
    ).toBeNull();
    openAdvanced();
    expect(container.querySelector("input")).toBeNull();
    expect(mocks.setRelayUrl).not.toHaveBeenCalled();
  });

  it.each(["", "wss://custom.example.test/v1/mobile/ws"])(
    "initializes only an empty relay URL when enabling: %s",
    async (url) => {
      mocks.settings.set("mobileRemote.relayEnabled", false);
      mocks.settings.set("mobileRemote.relayUrl", url);
      await renderSection();
      openAdvanced();
      act(() =>
        container
          .querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]
          .click()
      );
      if (url) expect(mocks.setRelayUrl).not.toHaveBeenCalled();
      else
        expect(mocks.setRelayUrl).toHaveBeenCalledWith(
          MOBILE_REMOTE_RELAY_PRODUCTION_URL
        );
    }
  );

  it("initializes the address when re-enabling mobile remote with relay already enabled", async () => {
    mocks.settings.set("mobileRemote.enabled", false);
    mocks.settings.set("mobileRemote.relayUrl", "");
    await renderSection();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="switch"]')?.click()
    );
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        "mobileRemote.enabled": true,
        "mobileRemote.relayEnabled": true,
        "mobileRemote.relayUrl": MOBILE_REMOTE_RELAY_PRODUCTION_URL,
      })
    );
  });

  it("enables relay and its default endpoint in one persisted activation", async () => {
    mocks.settings.set("mobileRemote.enabled", false);
    mocks.settings.set("mobileRemote.relayEnabled", false);
    mocks.settings.set("mobileRemote.relayUrl", "");
    await renderSection();
    await act(async () =>
      (container.querySelector('[role="switch"]') as HTMLButtonElement).click()
    );
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      "mobileRemote.enabled": true,
      "mobileRemote.relayEnabled": true,
      "mobileRemote.relayUrl": MOBILE_REMOTE_RELAY_PRODUCTION_URL,
      "mobileRemote.lanToken": "lan-token",
    });
    expect(
      container.querySelector('[role="switch"]')?.getAttribute("aria-checked")
    ).toBe("true");
  });

  it("preserves a custom relay and does not revoke pairing on disable", async () => {
    mocks.settings.set("mobileRemote.enabled", false);
    mocks.settings.set(
      "mobileRemote.relayUrl",
      "wss://custom.example/v1/mobile/ws"
    );
    await renderSection();
    await act(async () =>
      (container.querySelector('[role="switch"]') as HTMLButtonElement).click()
    );
    expect(mocks.saveSettings.mock.calls[0][0]["mobileRemote.relayUrl"]).toBe(
      "wss://custom.example/v1/mobile/ws"
    );
    await act(async () =>
      (container.querySelector('[role="switch"]') as HTMLButtonElement).click()
    );
    expect(mocks.saveSettings).toHaveBeenLastCalledWith({
      "mobileRemote.enabled": false,
    });
  });

  it("keeps reconnect available while registration is pending", async () => {
    mocks.cloudAuth = { userId: "cloud-user" };
    mocks.settings.set("mobileRemote.enabled", true);
    mocks.settings.set("mobileRemote.relayEnabled", true);
    mocks.relayStatus = {
      phase: "connecting",
      message: null,
      reconnectAttempt: 0,
      connectedAtMs: null,
    };
    await renderSection();
    expect(findButtonByLabel("mobileRemote.retryConnection").disabled).toBe(
      false
    );
    await act(async () => clickLabel("mobileRemote.retryConnection"));
    expect(mobileRemoteApi.notifyCloudAuthChanged).toHaveBeenCalledOnce();
  });

  it("blocks duplicate activation while saving and allows retry after failure", async () => {
    mocks.settings.set("mobileRemote.enabled", false);
    let reject!: (error: Error) => void;
    mocks.saveSettings.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    await renderSection();
    const toggle = container.querySelector(
      '[role="switch"]'
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
      toggle.click();
    });
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => reject(new Error("disk write failed")));
    expect(Message.error).toHaveBeenCalledWith({
      content: "Error: disk write failed",
    });
    expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click());
    expect(mocks.saveSettings).toHaveBeenCalledTimes(2);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("collapses advanced settings on remount without changing the saved address", async () => {
    await renderSection();
    openAdvanced();
    act(() => root.unmount());
    root = createRoot(container);
    await renderSection();
    expect(container.querySelector("input")).toBeNull();
    expect(mocks.setRelayUrl).not.toHaveBeenCalled();
  });

  it("restores the default address only on explicit request", async () => {
    await renderSection();
    openAdvanced();
    const actionsRow = container.querySelector(
      '[data-testid="mobile-remote-relay-actions"]'
    );
    expect(actionsRow?.querySelector("input")).toBeNull();
    expect(actionsRow?.className).toContain("justify-end");
    for (const label of [
      "mobileRemote.restoreDefaultRelay",
      "mobileRemote.developerOptions",
    ]) {
      const action = Array.from(
        actionsRow?.querySelectorAll<HTMLButtonElement>("button") ?? []
      ).find((candidate) => candidate.textContent?.trim() === label);
      expect(action?.className).toContain("border-border-2");
    }
    clickText("mobileRemote.restoreDefaultRelay");
    expect(mocks.setRelayUrl).toHaveBeenCalledWith(
      MOBILE_REMOTE_RELAY_PRODUCTION_URL
    );
  });

  it("requests an actual reconnect and prevents duplicate retries while pending", async () => {
    mocks.cloudAuth = { userId: "user-1" };
    let resolve!: () => void;
    vi.mocked(mobileRemoteApi.notifyCloudAuthChanged).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    await renderSection();
    const retryButton = findButtonByLabel("mobileRemote.retryConnection");
    const actionGroup = retryButton.parentElement;
    expect(actionGroup?.className).toContain("gap-2");
    expect(actionGroup?.children[0]?.getAttribute("role")).toBe("switch");
    expect(actionGroup?.children[1]).toBe(retryButton);
    expect(retryButton.className).toContain("border-border-2");
    expect(retryButton.textContent?.trim()).toBe("");

    clickLabel("mobileRemote.retryConnection");
    clickLabel("mobileRemote.retryConnection");
    expect(mobileRemoteApi.notifyCloudAuthChanged).toHaveBeenCalledOnce();
    await act(async () => resolve());
    vi.mocked(mobileRemoteApi.notifyCloudAuthChanged).mockRejectedValueOnce(
      new Error("offline")
    );
    await act(async () => clickLabel("mobileRemote.retryConnection"));
    expect(Message.error).toHaveBeenCalledWith({ content: "Error: offline" });
    await act(async () => clickLabel("mobileRemote.retryConnection"));
    expect(mobileRemoteApi.notifyCloudAuthChanged).toHaveBeenCalledTimes(3);
  });

  it("reflects the production preset when the relay URL matches production", async () => {
    await renderSection();
    openAdvanced();
    clickText("mobileRemote.developerOptions");

    expect(
      findPresetButton(
        container,
        "mobileRemote.relayPresetProduction"
      ).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      findPresetButton(container, "mobileRemote.relayPresetLocal").getAttribute(
        "aria-pressed"
      )
    ).toBe("false");
  });

  it("shows no selected preset for a custom relay URL", async () => {
    mocks.settings.set(
      "mobileRemote.relayUrl",
      "wss://custom.example.test/v1/mobile/ws"
    );
    await renderSection();
    openAdvanced();
    clickText("mobileRemote.developerOptions");

    expect(
      container.querySelector('[data-testid="mobile-remote-relay-preset"]')
    ).not.toBeNull();
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it("writes the local preset URL when the local segment is clicked", async () => {
    await renderSection();
    openAdvanced();
    clickText("mobileRemote.developerOptions");

    act(() => {
      findPresetButton(container, "mobileRemote.relayPresetLocal").click();
    });

    expect(mocks.setRelayUrl).toHaveBeenCalledWith(
      MOBILE_REMOTE_RELAY_LOCAL_URL
    );
  });

  it("prompts for ORG2 Cloud login on production preset when signed out", async () => {
    await renderSection();

    expect(
      container.querySelector('[data-testid="mobile-remote-cloud-sign-in"]')
    ).not.toBeNull();
    expect(container.textContent).toContain("mobileRemote.cloudLoginTitle");
    expect(container.textContent).toContain(
      "mobileRemote.cloudLoginDescSignedOut"
    );
    const loginRow = Array.from(
      container.querySelectorAll<HTMLElement>(".section-layout-row")
    ).find((row) => row.textContent?.includes("mobileRemote.cloudLoginTitle"));
    expect(loginRow?.className).toContain("@[480px]:flex-row");
    expect(container.textContent).not.toContain("mobileRemote.desktopToken");
  });

  it("shows the cloud sign-in row above outdoor connection before relay is enabled", async () => {
    mocks.settings.set("mobileRemote.relayEnabled", false);
    await renderSection();

    openAdvanced();
    const text = container.textContent ?? "";
    expect(text.indexOf("mobileRemote.cloudLoginTitle")).toBeLessThan(
      text.indexOf("mobileRemote.outdoorTitle")
    );

    const signInButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="mobile-remote-cloud-sign-in"]'
    );
    expect(signInButton).not.toBeNull();

    act(() => signInButton?.click());
    expect(mocks.cloudSignIn).toHaveBeenCalledOnce();
  });

  it("shows cloud identity instead of desktop token on production preset when signed in", async () => {
    mocks.cloudAuth = {
      userId: "user-1",
      profile: { displayName: "Junyu" },
    };
    await renderSection();

    expect(
      container.querySelector('[data-testid="mobile-remote-cloud-sign-in"]')
    ).toBeNull();
    expect(container.textContent).toContain(
      "mobileRemote.cloudLoginDescSignedIn:Junyu"
    );
    expect(container.textContent).not.toContain("mobileRemote.desktopToken");
  });

  it("uses the same ORG2 Cloud login row for the local preset", async () => {
    mocks.settings.set("mobileRemote.relayUrl", MOBILE_REMOTE_RELAY_LOCAL_URL);
    await renderSection();
    openAdvanced();

    expect(container.textContent).toContain("mobileRemote.cloudLoginTitle");
    expect(container.textContent).toContain(
      "mobileRemote.cloudLoginDescSignedOut"
    );
    expect(
      container.querySelector('[data-testid="mobile-remote-cloud-sign-in"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("mobileRemote.desktopToken");
  });

  it("disables outdoor pairing until ORG2 Cloud login on production preset", async () => {
    await renderSection();

    const pairingButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "mobileRemote.addPhone"
    );
    expect(pairingButton?.disabled).toBe(true);
  });

  it("disables outdoor pairing until ORG2 Cloud login on the local preset", async () => {
    mocks.settings.set("mobileRemote.relayUrl", MOBILE_REMOTE_RELAY_LOCAL_URL);
    await renderSection();

    const pairingButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "mobileRemote.addPhone"
    );
    expect(pairingButton?.disabled).toBe(true);
  });

  it("enables outdoor pairing on the local preset after ORG2 Cloud login", async () => {
    mocks.cloudAuth = {
      userId: "user-1",
      profile: { displayName: "Junyu" },
    };
    mocks.settings.set("mobileRemote.relayUrl", MOBILE_REMOTE_RELAY_LOCAL_URL);
    await renderSection();

    const pairingButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "mobileRemote.addPhone"
    );
    expect(pairingButton?.disabled).toBe(false);
    expect(container.textContent).toContain(
      "mobileRemote.cloudLoginDescSignedIn:Junyu"
    );
  });

  it.each(["full", "read_only"] as const)(
    "pairs with an automatic phone name and %s access after retrying a failure",
    async (tier) => {
      mocks.cloudAuth = { userId: "user-1" };
      // A previously enabled LAN setting must not restore the removed UI.
      mocks.settings.set("mobileRemote.allowLanExposure", true);
      await renderSection();

      expect(container.textContent).not.toContain("mobileRemote.phoneLabel");
      expect(container.textContent).not.toContain("mobileRemote.lanAdvanced");
      expect(container.textContent).not.toContain("mobileRemote.refreshLanIp");

      clickText("mobileRemote.addPhone");
      if (tier === "read_only") {
        clickText("mobileRemote.deviceTierReadOnly");
      }

      const findButton = (label: string): HTMLButtonElement => {
        const button = Array.from(container.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.trim() === label
        );
        if (!button) throw new Error(`Missing button: ${label}`);
        return button;
      };

      vi.mocked(mobileRemoteApi.pairInit).mockRejectedValueOnce(
        new Error("offline")
      );
      await act(async () => {
        findButton("mobileRemote.startOutdoorPairing").click();
      });
      expect(findButton("mobileRemote.startOutdoorPairing").disabled).toBe(
        false
      );

      const pairing: PairingInitOutput = {
        pairingCode: "PAIR-1234",
        confirmationPhrase: "ember-delta-coral",
        qrPayload: "https://relay.example.test/orgii/mobile#pair=payload",
        expiresInSeconds: 120,
      };
      let resolvePairing!: (value: PairingInitOutput) => void;
      vi.mocked(mobileRemoteApi.pairInit).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePairing = resolve;
          })
      );
      await act(async () => {
        findButton("mobileRemote.startOutdoorPairing").click();
      });
      expect(findButton("mobileRemote.startOutdoorPairing").disabled).toBe(
        true
      );
      expect(mobileRemoteApi.pairInit).toHaveBeenLastCalledWith({
        label: expect.stringMatching(/^Phone · .+ \d{2}:\d{2}$/),
        tier,
        isPrimary: true,
      });

      await act(async () => resolvePairing(pairing));
      expect(container.textContent).toContain(pairing.confirmationPhrase);
      await act(async () => {
        findButton("mobileRemote.confirmPairing").click();
      });
      expect(mobileRemoteApi.pairComplete).toHaveBeenLastCalledWith({
        pairingCode: pairing.pairingCode,
        tier,
      });
      expect(findButton("mobileRemote.addPhone").disabled).toBe(false);
    }
  );
  it("keeps login status in a left-right row and advanced settings in a separate section", async () => {
    mocks.cloudAuth = { userId: "user-1", profile: { displayName: "Junyu" } };
    mocks.relayStatus = {
      phase: "online",
      message: null,
      reconnectAttempt: 0,
      connectedAtMs: 1,
    };
    await renderSection();
    expect((container.textContent?.match(/Junyu/g) ?? []).length).toBe(1);
    expect(container.textContent).toContain("mobileRemote.cloudLoginTitle");
    const loginRow = Array.from(
      container.querySelectorAll<HTMLElement>(".section-layout-row")
    ).find((row) =>
      row.textContent?.includes("mobileRemote.cloudLoginDescSignedIn:Junyu")
    );
    expect(loginRow?.textContent).toContain("mobileRemote.cloudLoginTitle");
    expect(loginRow?.className).toContain("@[480px]:flex-row");
    expect(container.textContent).not.toContain("mobileRemote.outdoorTitle");
    expect(container.textContent).not.toContain("mobileRemote.fullAccess");
    expect(container.textContent).not.toContain("mobileRemote.sasDesktopHint");
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
    const text = container.textContent ?? "";
    expect(text.indexOf("mobileRemote.addPhone")).toBeLessThan(
      text.indexOf("mobileRemote.pairedDevices")
    );
    expect(text.indexOf("mobileRemote.pairedDevices")).toBeLessThan(
      text.indexOf("mobileRemote.advancedSettings")
    );
    expect(
      container
        .querySelector('[data-testid="mobile-remote-advanced-toggle"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false");
    expect(
      container
        .querySelector('[data-testid="mobile-remote-advanced-toggle"]')
        ?.closest(".section-layout-row")
    ).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "mobileRemote.relayStatus_online"
    );
    expect(text).not.toContain("common:actions.refresh");
    expect(text).not.toContain("mobileRemote.retryConnection");
  });

  it.each(["subscription", "read"])(
    "preserves manual recovery after a %s failure",
    async (failure) => {
      mocks.cloudAuth = { userId: "user-1" };
      mocks.relayStatus = {
        phase: "online",
        message: null,
        reconnectAttempt: 0,
        connectedAtMs: 1,
      };
      mocks.manualRefreshRequired = failure === "subscription";
      mocks.relayStatusError = failure === "read" ? "status unavailable" : null;
      await renderSection();
      clickLabel("common:actions.refresh");
      expect(mocks.refreshRelayStatus).toHaveBeenCalledOnce();
      expect(mobileRemoteApi.notifyCloudAuthChanged).not.toHaveBeenCalled();
    }
  );

  it("preserves the connected snapshot during an automatic status refresh", async () => {
    mocks.cloudAuth = { userId: "user-1" };
    mocks.relayStatus = {
      phase: "online",
      message: null,
      reconnectAttempt: 0,
      connectedAtMs: 1,
    };
    mocks.relayStatusLoading = true;
    await renderSection();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "mobileRemote.relayStatus_online"
    );
    expect(container.textContent).not.toContain("common:actions.refresh");
  });

  it("keeps device management and advanced recovery available with internet connections off", async () => {
    mocks.cloudAuth = { userId: "user-1" };
    mocks.settings.set("mobileRemote.relayEnabled", false);
    mocks.devices = [
      {
        deviceId: "phone-123456",
        desktopId: "desktop-1",
        label: "My phone",
        tier: "read_only",
        isPrimary: true,
        pairedAtMs: 1,
        lastSeenMs: 2,
      },
    ];
    await renderSection();
    expect(container.textContent).toContain("mobileRemote.relayDisabledHint");
    expect(
      container.querySelector(
        '[data-testid="mobile-remote-paired-device-phone-123456"]'
      )
    ).not.toBeNull();
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mobileRemote.addPhone"
    );
    expect(add?.disabled).toBe(true);
    openAdvanced();
    expect(
      container.querySelector('[aria-label="mobileRemote.outdoorTitle"]')
    ).not.toBeNull();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(mocks.settings.get("mobileRemote.allowLanExposure")).toBe(false);
  });

  it("keeps the device loading, empty, and error recovery states", async () => {
    mocks.cloudAuth = { userId: "user-1" };
    mocks.devicesLoading = true;
    await renderSection();
    expect(container.textContent).not.toContain("mobileRemote.noDevices");
    mocks.devicesLoading = false;
    await renderSection();
    expect(container.textContent).toContain("mobileRemote.noDevices");
    mocks.devicesError = "device list unavailable";
    await renderSection();
    expect(container.textContent).toContain("mobileRemote.devicesLoadFailed");
    expect(container.textContent).toContain("device list unavailable");
    clickText("actions.retry");
    expect(mocks.refreshDevices).toHaveBeenCalledOnce();
  });
});
