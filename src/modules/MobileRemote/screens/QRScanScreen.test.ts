// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { QRScanScreen } from "./QRScanScreen";

const mock = vi.hoisted(() => ({
  scanQr: vi.fn(),
  hidden: false,
  listener: () => {},
  unsubscribe: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../platform", () => ({ useMobileRemotePlatform: () => platform }));
const platform = {
  scanQr: mock.scanQr,
  runtime: {
    isHidden: () => mock.hidden,
    subscribeVisibility: (listener: () => void) => {
      mock.listener = listener;
      return mock.unsubscribe;
    },
  },
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let accept: ReturnType<typeof vi.fn>;
let resolveScan: (value: string) => void;
let rejectScan: (error: unknown) => void;
const click = async (text: string) =>
  act(() => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent === text
    );
    expect(button).toBeTruthy();
    button!.click();
  });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.hidden = false;
  mock.scanQr.mockReset();
  mock.unsubscribe.mockClear();
  mock.scanQr.mockImplementation(
    () =>
      new Promise<string>((resolve, reject) => {
        resolveScan = resolve;
        rejectScan = reject;
      })
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  accept = vi.fn();
  await act(() =>
    root.render(React.createElement(QRScanScreen, { onAcceptPairing: accept }))
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});
it("opens camera only on click and uses existing pairing parsing", async () => {
  expect(mock.scanQr).not.toHaveBeenCalled();
  await click("pairing.scanCamera");
  expect(host.querySelector("video")).not.toBeNull();
  await act(() => resolveScan("wss://relay.example.com/mobile/ws?token=abc"));
  expect(accept).toHaveBeenCalledTimes(1);
  expect(accept.mock.calls[0][0].config.wsUrl).toContain("relay.example.com");
  expect(host.querySelector("video")).toBeNull();
});
it("rejects non-pairing QR and allows retry", async () => {
  await click("pairing.scanCamera");
  await act(() => resolveScan("https://unrelated.example"));
  expect(accept).not.toHaveBeenCalled();
  expect(host.textContent).toContain("pairing.errors.invalid");
  await click("pairing.scanCamera");
  expect(mock.scanQr).toHaveBeenCalledTimes(2);
});
it("shows denied permission and preserves paste entry", async () => {
  await click("pairing.scanCamera");
  await act(() => rejectScan(new DOMException("denied", "NotAllowedError")));
  expect(host.textContent).toContain("pairing.cameraDenied");
  expect(host.querySelector("textarea")!.disabled).toBe(false);
});
it("cancel aborts and ignores a late scan result", async () => {
  await click("pairing.scanCamera");
  const signal = mock.scanQr.mock.calls[0][1] as AbortSignal;
  await click("pairing.cancelScan");
  expect(signal.aborted).toBe(true);
  await act(() => resolveScan("wss://relay.example.com/mobile/ws?token=abc"));
  expect(accept).not.toHaveBeenCalled();
});
it("backgrounding aborts scanning and does not auto restart", async () => {
  await click("pairing.scanCamera");
  const signal = mock.scanQr.mock.calls[0][1] as AbortSignal;
  await act(() => {
    mock.hidden = true;
    mock.listener();
  });
  expect(signal.aborted).toBe(true);
  expect(mock.unsubscribe).toHaveBeenCalled();
  expect(host.querySelector("video")).toBeNull();
});
