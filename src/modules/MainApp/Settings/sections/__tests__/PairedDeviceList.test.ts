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

import type { PairedDeviceInfo } from "@src/api/tauri/mobileRemote";

import PairedDeviceList from "../PairedDeviceList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { time?: string }) => {
      const labels: Record<string, string> = {
        "mobileRemote.deviceTierFull": "Can control",
        "mobileRemote.deviceTierReadOnly": "View only",
        "mobileRemote.deviceNeverSeen": "Never connected",
        "mobileRemote.deviceOnline": "Online",
        "mobileRemote.deviceOffline": "Offline",
        "mobileRemote.revokeDevice": "Revoke",
        "mobileRemote.deviceLastSeenValue": `Last online ${values?.time}`,
        "mobileRemote.devicePairedAt": `Paired ${values?.time}`,
      };
      return labels[key] ?? key;
    },
  }),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function device(overrides: Partial<PairedDeviceInfo>): PairedDeviceInfo {
  return {
    deviceId: "device-123456",
    desktopId: "desktop-1",
    label: "Phone · Sep 12 10:00",
    tier: "full",
    isPrimary: false,
    pairedAtMs: 1_000,
    lastSeenMs: null,
    ...overrides,
  };
}

describe("PairedDeviceList", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function renderDevices(
    devices: readonly PairedDeviceInfo[],
    onRevoke = vi.fn()
  ): void {
    act(() => {
      root.render(
        createElement(PairedDeviceList, {
          devices,
          onRevoke,
          formatTimestamp: (ms) => `t:${ms}`,
        })
      );
    });
  }

  function rows(): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="mobile-remote-paired-device-list"] > [data-testid]'
      )
    );
  }

  it("keeps every device, name, and suffix while showing its own access and last online", () => {
    const devices = Object.freeze([
      device({ deviceId: "device-aabbcc", lastSeenMs: 100_000 }),
      device({
        deviceId: "device-ddeeff",
        tier: "read_only",
        lastSeenMs: 999_000,
      }),
      device({ deviceId: "device-112233", label: "Personal phone" }),
      device({ deviceId: "device-445566", tier: "read_only", lastSeenMs: 0 }),
    ]);

    renderDevices(devices);

    const deviceRows = rows();
    expect(deviceRows).toHaveLength(4);
    expect(deviceRows.map((row) => row.dataset.testid)).toEqual([
      "mobile-remote-paired-device-device-ddeeff",
      "mobile-remote-paired-device-device-aabbcc",
      "mobile-remote-paired-device-device-112233",
      "mobile-remote-paired-device-device-445566",
    ]);
    expect(
      deviceRows.map((row) => row.querySelector("p")?.textContent)
    ).toEqual([
      "View only · Last online t:999000",
      "Can control · Last online t:100000",
      "Can control · Never connected",
      "View only · Never connected",
    ]);
    expect(deviceRows[0].textContent).toContain(
      "Phone · Sep 12 10:00 · DDEEFF"
    );
    expect(deviceRows[1].textContent).toContain(
      "Phone · Sep 12 10:00 · AABBCC"
    );
    expect(deviceRows[2].textContent).toContain("Personal phone · 112233");
    expect(deviceRows[0].querySelector('[aria-label="Online"]')).not.toBeNull();
    expect(
      deviceRows[1].querySelector('[aria-label="Offline"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Paired");
    expect(deviceRows[0].querySelector("p")?.title).toBe(
      "Paired t:1000 · View only · Last online t:999000"
    );
    expect(devices.map((entry) => entry.deviceId)).toEqual([
      "device-aabbcc",
      "device-ddeeff",
      "device-112233",
      "device-445566",
    ]);
  });

  it("keeps each revoke action bound to the rendered device after a list update", () => {
    const onRevoke = vi.fn();
    const older = device({ deviceId: "device-aabbcc", lastSeenMs: 100_000 });
    const newer = device({ deviceId: "device-ddeeff", lastSeenMs: 999_000 });
    renderDevices([older, newer], onRevoke);

    act(() => rows()[0].querySelector("button")?.click());
    expect(onRevoke).toHaveBeenLastCalledWith("device-ddeeff");

    renderDevices([{ ...older, lastSeenMs: 1_000_000 }, newer], onRevoke);

    act(() => rows()[0].querySelector("button")?.click());
    expect(onRevoke).toHaveBeenLastCalledWith("device-aabbcc");
    expect(onRevoke).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(2);
  });
});
