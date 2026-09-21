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

import type { PairingInitOutput } from "@src/api/tauri/mobileRemote";

import MobileRemoteSettingsSection from "../MobileRemoteSettingsSection";

vi.mock("../useMobileRelayStatus", () => ({
  useMobileRelayStatus: () => ({
    data: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const mocks = vi.hoisted(() => ({
  cloudAuth: {
    userId: "cloud-user",
    supabaseUrl: "https://cloud.example.test",
    accessToken: "initial-token",
    profile: { displayName: "Test user" },
  } as {
    userId: string;
    supabaseUrl: string;
    accessToken: string;
    profile: { displayName: string };
  } | null,
  error: vi.fn(),
  pairComplete: vi.fn(),
  pairInit: vi.fn(),
  refresh: vi.fn(),
  revokeDevice: vi.fn(),
  settings: new Map<string, unknown>(),
  success: vi.fn(),
  syncDevices: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { seconds?: number }) =>
      values?.seconds == null ? key : `${key}:${values.seconds}`,
  }),
}));

vi.mock("@src/api/tauri/mobileRemote", () => ({
  mobileRemoteApi: {
    getRelayStatus: vi.fn(),
    pairComplete: mocks.pairComplete,
    pairInit: mocks.pairInit,
    revokeDevice: mocks.revokeDevice,
    syncDevices: mocks.syncDevices,
  },
  PERMISSION_TIER: { FULL: "full", READ_ONLY: "read_only" },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useAtomValue: () => mocks.cloudAuth,
  };
});

vi.mock("@src/features/Org2Cloud/useOrg2CloudSignIn", () => ({
  useOrg2CloudSignIn: () => vi.fn(),
}));

vi.mock("@src/components/Message", () => ({
  default: { error: mocks.error, success: mocks.success },
}));

vi.mock("@src/hooks/settings/useSettings", () => ({
  useSetting: (key: string) => [mocks.settings.get(key), vi.fn()],
}));

vi.mock("@src/hooks/async/useAsyncData", () => ({
  useAsyncData: <T>({ initialData }: { initialData: T }) => ({
    data: initialData,
    error: null,
    loading: false,
    refresh: mocks.refresh,
  }),
}));

const firstPairing: PairingInitOutput = {
  pairingCode: "PAIR-1",
  confirmationPhrase: "ember-delta-coral",
  qrPayload: "https://relay.example.test/orgii/mobile#pair=first",
  expiresInSeconds: 120,
};

const secondPairing: PairingInitOutput = {
  pairingCode: "PAIR-2",
  confirmationPhrase: "harbor-amber-grove",
  qrPayload: "https://relay.example.test/orgii/mobile#pair=second",
  expiresInSeconds: 120,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
}

describe("MobileRemoteSettingsSection outdoor pairing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.cloudAuth = {
      userId: "cloud-user",
      supabaseUrl: "https://cloud.example.test",
      accessToken: "initial-token",
      profile: { displayName: "Test user" },
    };
    mocks.settings.clear();
    mocks.settings.set("mobileRemote.enabled", true);
    mocks.settings.set("mobileRemote.relayEnabled", true);
    mocks.settings.set(
      "mobileRemote.relayUrl",
      "wss://relay.example.test/v1/mobile/ws"
    );
    mocks.settings.set("mobileRemote.allowLanExposure", false);
    mocks.settings.set("mobileRemote.lanToken", "lan-token");
    mocks.settings.set("mobileRemote.lanPort", 13847);
    mocks.error.mockReset();
    mocks.pairComplete.mockReset();
    mocks.pairInit.mockReset();
    mocks.refresh.mockReset();
    mocks.revokeDevice.mockReset();
    mocks.success.mockReset();
    mocks.syncDevices.mockReset();
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

  function openPairing(): void {
    act(() => findButton(container, "mobileRemote.addPhone").click());
  }

  async function generatePairing(): Promise<void> {
    openPairing();
    await act(async () => {
      findButton(container, "mobileRemote.startOutdoorPairing").click();
    });
  }

  function payload(): string | undefined {
    return container.querySelector<HTMLTextAreaElement>(
      "#mobile-remote-pairing-payload"
    )?.value;
  }

  it("reveals the copyable payload after generation and preserves it during regeneration", async () => {
    const firstRequest = deferred<PairingInitOutput>();
    const secondRequest = deferred<PairingInitOutput>();
    mocks.pairInit
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    await renderSection();
    openPairing();

    const startButton = findButton(
      container,
      "mobileRemote.startOutdoorPairing"
    );
    act(() => startButton.click());
    expect(startButton.disabled).toBe(true);
    expect(
      container.querySelector("#mobile-remote-pairing-payload")
    ).toBeNull();

    await act(async () => firstRequest.resolve(firstPairing));
    expect(mocks.pairInit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        isPrimary: true,
        tier: "full",
        label: expect.stringMatching(/^Phone · /),
      })
    );
    expect(
      container.querySelector<HTMLTextAreaElement>(
        "#mobile-remote-pairing-payload"
      )?.value
    ).toBe(firstPairing.qrPayload);

    act(() => {
      findButton(container, "mobileRemote.regeneratePairing").click();
    });
    expect(
      container.querySelector<HTMLTextAreaElement>(
        "#mobile-remote-pairing-payload"
      )?.value
    ).toBe(firstPairing.qrPayload);
    expect(
      findButton(container, "mobileRemote.copyPairingPayload").disabled
    ).toBe(true);
    expect(findButton(container, "mobileRemote.confirmPairing").disabled).toBe(
      true
    );

    await act(async () => secondRequest.resolve(secondPairing));
    expect(
      container.querySelector<HTMLTextAreaElement>(
        "#mobile-remote-pairing-payload"
      )?.value
    ).toBe(secondPairing.qrPayload);
  });

  it.each(["relay-url", "cloud-endpoint"])(
    "ignores a stale pairing response after %s changes",
    async (scope) => {
      const request = deferred<PairingInitOutput>();
      mocks.pairInit.mockReturnValue(request.promise);
      await renderSection();
      openPairing();
      act(() => {
        findButton(container, "mobileRemote.startOutdoorPairing").click();
      });

      if (scope === "relay-url") {
        mocks.settings.set(
          "mobileRemote.relayUrl",
          "wss://other-relay.example.test/v1/mobile/ws"
        );
      } else if (mocks.cloudAuth) {
        mocks.cloudAuth = {
          ...mocks.cloudAuth,
          supabaseUrl: "https://other-cloud.example.test",
        };
      }
      await renderSection();
      await act(async () => request.resolve(firstPairing));

      expect(
        container.querySelector("#mobile-remote-pairing-payload")
      ).toBeNull();
      expect(container.textContent).toContain("mobileRemote.addPhone");
    }
  );

  it("opens permission selection only when adding a phone and completes with the chosen permission", async () => {
    mocks.pairInit.mockResolvedValue(firstPairing);
    mocks.pairComplete.mockResolvedValue(undefined);
    await renderSection();

    expect(container.textContent).not.toContain("mobileRemote.fullAccess");
    expect(container.textContent).not.toContain(
      "mobileRemote.pairingPermission"
    );
    expect(mocks.pairInit).not.toHaveBeenCalled();
    openPairing();
    expect(container.textContent).toContain("mobileRemote.pairingPermission");
    act(() => findButton(container, "mobileRemote.deviceTierReadOnly").click());
    await act(async () => {
      findButton(container, "mobileRemote.startOutdoorPairing").click();
    });

    const fullPermission = findButton(container, "mobileRemote.deviceTierFull");
    expect(fullPermission.disabled).toBe(true);
    expect(
      findButton(container, "mobileRemote.deviceTierReadOnly").getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    act(() => fullPermission.click());
    await act(async () => {
      findButton(container, "mobileRemote.confirmPairing").click();
    });

    expect(mocks.pairInit).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "read_only" })
    );
    expect(mocks.pairComplete).toHaveBeenCalledWith({
      pairingCode: firstPairing.pairingCode,
      tier: "read_only",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith({
      content: "mobileRemote.pairingConfirmed",
    });
    expect(payload()).toBeUndefined();
    expect(container.textContent).toContain("mobileRemote.addPhone");
  });

  it("locks permission during generation and prevents duplicate generation and confirmation requests", async () => {
    const initRequest = deferred<PairingInitOutput>();
    const confirmRequest = deferred<void>();
    mocks.pairInit.mockReturnValue(initRequest.promise);
    mocks.pairComplete.mockReturnValue(confirmRequest.promise);
    await renderSection();
    openPairing();
    act(() => {
      const button = findButton(container, "mobileRemote.startOutdoorPairing");
      button.click();
      button.click();
    });
    expect(mocks.pairInit).toHaveBeenCalledTimes(1);
    expect(
      findButton(container, "mobileRemote.deviceTierReadOnly").disabled
    ).toBe(true);
    await act(async () => initRequest.resolve(firstPairing));

    act(() => {
      const button = findButton(container, "mobileRemote.confirmPairing");
      button.click();
      // The previous render's cancel handler must not cancel an already sent confirmation.
      findButton(container, "common:actions.cancel").click();
      button.click();
    });
    expect(mocks.pairComplete).toHaveBeenCalledTimes(1);
    expect(findButton(container, "common:actions.cancel").disabled).toBe(true);
    expect(
      findButton(container, "mobileRemote.regeneratePairing").disabled
    ).toBe(true);
    expect(payload()).toBe(firstPairing.qrPayload);
    act(() => findButton(container, "common:actions.cancel").click());
    await act(async () => confirmRequest.resolve(undefined));
    expect(mocks.pairComplete).toHaveBeenCalledWith({
      pairingCode: firstPairing.pairingCode,
      tier: "full",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("allows generation retry and permission adjustment after a failed first request", async () => {
    mocks.pairInit
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(firstPairing);
    await renderSection();
    await generatePairing();
    expect(mocks.error).toHaveBeenCalledWith({
      content: "mobileRemote.pairingFailed: Error: offline",
    });
    expect(payload()).toBeUndefined();
    const readOnly = findButton(container, "mobileRemote.deviceTierReadOnly");
    expect(readOnly.disabled).toBe(false);
    act(() => readOnly.click());
    await act(async () => {
      findButton(container, "mobileRemote.startOutdoorPairing").click();
    });
    expect(mocks.pairInit).toHaveBeenLastCalledWith(
      expect.objectContaining({ tier: "read_only" })
    );
    expect(payload()).toBe(firstPairing.qrPayload);
  });

  it("preserves the QR code and permission when confirmation fails, then retries the same pairing", async () => {
    mocks.pairInit.mockResolvedValue(firstPairing);
    mocks.pairComplete
      .mockRejectedValueOnce(new Error("phone not ready"))
      .mockResolvedValueOnce(undefined);
    await renderSection();
    await generatePairing();
    await act(async () => {
      findButton(container, "mobileRemote.confirmPairing").click();
    });
    expect(payload()).toBe(firstPairing.qrPayload);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith({
      content: "Error: phone not ready",
    });
    expect(findButton(container, "mobileRemote.confirmPairing").disabled).toBe(
      false
    );
    expect(
      findButton(container, "mobileRemote.deviceTierReadOnly").disabled
    ).toBe(true);
    await act(async () => {
      findButton(container, "mobileRemote.confirmPairing").click();
    });
    expect(mocks.pairComplete.mock.calls).toEqual([
      [{ pairingCode: firstPairing.pairingCode, tier: "full" }],
      [{ pairingCode: firstPairing.pairingCode, tier: "full" }],
    ]);
    expect(mocks.pairInit).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("restores the previous code after regeneration fails and allows another attempt", async () => {
    mocks.pairInit
      .mockResolvedValueOnce(firstPairing)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(secondPairing);
    await renderSection();
    await generatePairing();
    await act(async () => {
      findButton(container, "mobileRemote.regeneratePairing").click();
    });
    expect(payload()).toBe(firstPairing.qrPayload);
    expect(findButton(container, "mobileRemote.confirmPairing").disabled).toBe(
      false
    );
    await act(async () => {
      findButton(container, "mobileRemote.regeneratePairing").click();
    });
    expect(payload()).toBe(secondPairing.qrPayload);
    expect(mocks.pairInit).toHaveBeenCalledTimes(3);
  });

  it.each(["success", "failure"])(
    "ignores cancelled generation %s without overwriting a newly opened flow",
    async (outcome) => {
      const oldRequest = deferred<PairingInitOutput>();
      mocks.pairInit
        .mockReturnValueOnce(oldRequest.promise)
        .mockResolvedValueOnce(secondPairing);
      await renderSection();
      await generatePairing();
      act(() => findButton(container, "common:actions.cancel").click());
      await generatePairing();
      await act(async () => {
        if (outcome === "success") oldRequest.resolve(firstPairing);
        else oldRequest.reject(new Error("stale failure"));
      });
      expect(payload()).toBe(secondPairing.qrPayload);
      expect(mocks.error).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    }
  );

  it("closes a generated pairing and resets permission for the next phone", async () => {
    mocks.pairInit.mockResolvedValue(firstPairing);
    await renderSection();
    openPairing();
    act(() => findButton(container, "mobileRemote.deviceTierReadOnly").click());
    await act(async () => {
      findButton(container, "mobileRemote.startOutdoorPairing").click();
    });
    act(() => findButton(container, "common:actions.cancel").click());
    expect(payload()).toBeUndefined();
    expect(mocks.pairComplete).not.toHaveBeenCalled();
    openPairing();
    expect(
      findButton(container, "mobileRemote.deviceTierFull").getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
  });

  it.each(["disabled", "relay-disabled", "signed-out"])(
    "does not start pairing while %s",
    async (condition) => {
      if (condition === "disabled") {
        mocks.settings.set("mobileRemote.enabled", false);
      } else if (condition === "relay-disabled") {
        mocks.settings.set("mobileRemote.relayEnabled", false);
      } else {
        mocks.cloudAuth = null;
      }
      await renderSection();
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === "mobileRemote.addPhone"
      );
      if (button) {
        expect(button.disabled).toBe(true);
        act(() => button.click());
      }
      expect(mocks.pairInit).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(
        "mobileRemote.pairingPermission"
      );
    }
  );

  it.each([
    "disabled",
    "relay-disabled",
    "account",
    "relay-url",
    "cloud-endpoint",
  ])("ignores a pending confirmation after %s scope change", async (scope) => {
    const request = deferred<void>();
    mocks.pairInit.mockResolvedValue(firstPairing);
    mocks.pairComplete.mockReturnValue(request.promise);
    await renderSection();
    await generatePairing();
    act(() => findButton(container, "mobileRemote.confirmPairing").click());

    if (scope === "disabled") {
      mocks.settings.set("mobileRemote.enabled", false);
    } else if (scope === "relay-disabled") {
      mocks.settings.set("mobileRemote.relayEnabled", false);
    } else if (scope === "account") {
      mocks.cloudAuth = {
        userId: "other-cloud-user",
        supabaseUrl: "https://cloud.example.test",
        accessToken: "initial-token",
        profile: { displayName: "Other user" },
      };
    } else if (scope === "cloud-endpoint" && mocks.cloudAuth) {
      mocks.cloudAuth = {
        ...mocks.cloudAuth,
        supabaseUrl: "https://other-cloud.example.test",
      };
    } else {
      mocks.settings.set(
        "mobileRemote.relayUrl",
        "wss://other-relay.example.test/v1/mobile/ws"
      );
    }
    await renderSection();
    await act(async () => request.resolve(undefined));
    expect(payload()).toBeUndefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("keeps pairing in progress when the same account refreshes its token or profile", async () => {
    const initRequest = deferred<PairingInitOutput>();
    const confirmRequest = deferred<void>();
    mocks.pairInit.mockReturnValue(initRequest.promise);
    mocks.pairComplete.mockReturnValue(confirmRequest.promise);
    await renderSection();
    await generatePairing();

    mocks.cloudAuth = {
      userId: "cloud-user",
      supabaseUrl: "https://cloud.example.test/",
      accessToken: "refreshed-token",
      profile: { displayName: "Updated name" },
    };
    await renderSection();
    await act(async () => initRequest.resolve(firstPairing));
    expect(payload()).toBe(firstPairing.qrPayload);

    act(() => findButton(container, "mobileRemote.confirmPairing").click());
    mocks.cloudAuth = {
      ...mocks.cloudAuth,
      accessToken: "second-refreshed-token",
    };
    await renderSection();
    expect(findButton(container, "mobileRemote.confirmPairing").disabled).toBe(
      true
    );
    await act(async () => confirmRequest.resolve(undefined));
    expect(mocks.success).toHaveBeenCalledWith({
      content: "mobileRemote.pairingConfirmed",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.pairInit).toHaveBeenCalledTimes(1);
  });

  it("ignores a failed confirmation after account sign-out", async () => {
    const request = deferred<void>();
    mocks.pairInit.mockResolvedValue(firstPairing);
    mocks.pairComplete.mockReturnValue(request.promise);
    await renderSection();
    await generatePairing();
    act(() => findButton(container, "mobileRemote.confirmPairing").click());
    mocks.cloudAuth = null;
    await renderSection();
    await act(async () => request.reject(new Error("expired auth")));
    expect(payload()).toBeUndefined();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
