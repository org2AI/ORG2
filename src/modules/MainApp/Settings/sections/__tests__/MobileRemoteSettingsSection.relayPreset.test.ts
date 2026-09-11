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
  type PairingInitOutput,
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
  cloudSignIn: vi.fn(),
  settings: new Map<string, unknown>(),
  setRelayUrl: vi.fn(),
  saveSettings: vi.fn(),
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
    useAtomValue: () => mocks.cloudAuth,
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
    if (key === "mobileRemote.relayUrl") {
      return [mocks.settings.get(key), mocks.setRelayUrl];
    }
    return [mocks.settings.get(key), vi.fn()];
  },
}));

vi.mock("@src/hooks/async/useAsyncData", () => ({
  useAsyncData: <T>({ initialData }: { initialData: T }) => ({
    data: initialData,
    error: null,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../useMobileRelayStatus", () => ({
  useMobileRelayStatus: () => ({
    data: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
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
    expect(container.textContent).toContain("mobileRemote.relayStatus");
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
    clickText("mobileRemote.restoreDefaultRelay");
    expect(mocks.setRelayUrl).toHaveBeenCalledWith(
      MOBILE_REMOTE_RELAY_PRODUCTION_URL
    );
  });

  it("requests an actual reconnect and prevents duplicate retries while pending", async () => {
    let resolve!: () => void;
    vi.mocked(mobileRemoteApi.notifyCloudAuthChanged).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    await renderSection();
    clickText("mobileRemote.retryConnection");
    clickText("mobileRemote.retryConnection");
    expect(mobileRemoteApi.notifyCloudAuthChanged).toHaveBeenCalledOnce();
    await act(async () => resolve());
    vi.mocked(mobileRemoteApi.notifyCloudAuthChanged).mockRejectedValueOnce(
      new Error("offline")
    );
    await act(async () => clickText("mobileRemote.retryConnection"));
    expect(Message.error).toHaveBeenCalledWith({ content: "Error: offline" });
    await act(async () => clickText("mobileRemote.retryConnection"));
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
    expect(container.textContent).not.toContain("mobileRemote.desktopToken");
  });

  it("shows the cloud sign-in row above outdoor connection before relay is enabled", async () => {
    mocks.settings.set("mobileRemote.relayEnabled", false);
    await renderSection();

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
      (candidate) =>
        candidate.textContent?.trim() === "mobileRemote.startOutdoorPairing"
    );
    expect(pairingButton?.disabled).toBe(true);
  });

  it("disables outdoor pairing until ORG2 Cloud login on the local preset", async () => {
    mocks.settings.set("mobileRemote.relayUrl", MOBILE_REMOTE_RELAY_LOCAL_URL);
    await renderSection();

    const pairingButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent?.trim() === "mobileRemote.startOutdoorPairing"
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
      (candidate) =>
        candidate.textContent?.trim() === "mobileRemote.startOutdoorPairing"
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

      if (tier === "read_only") {
        const switches =
          container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
        act(() => switches[switches.length - 1].click());
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
      expect(findButton("mobileRemote.startOutdoorPairing").disabled).toBe(
        false
      );
    }
  );
});
