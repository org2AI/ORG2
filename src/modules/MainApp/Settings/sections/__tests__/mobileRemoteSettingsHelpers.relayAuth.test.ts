import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import {
  formatMobileRemoteRelayStatusMessage,
  isMobileRemoteRelayReady,
} from "../mobileRemoteSettingsHelpers";

describe("mobileRemoteSettingsHelpers relay auth", () => {
  const t = ((key: string) => key) as TFunction<"settings">;

  it.each([
    "ws://127.0.0.1:8787/v1/mobile/ws",
    "wss://orgii-mobile-relay.superficial-jasper.workers.dev/v1/mobile/ws",
    "wss://custom.example.test/v1/mobile/ws",
  ])("requires ORG2 Cloud login for relay readiness at %s", (relayUrl) => {
    expect(isMobileRemoteRelayReady({ relayUrl, cloudSignedIn: false })).toBe(
      false
    );
    expect(isMobileRemoteRelayReady({ relayUrl, cloudSignedIn: true })).toBe(
      true
    );
  });

  it("maps auth failures to ORG2 Cloud guidance on production relay", () => {
    expect(
      formatMobileRemoteRelayStatusMessage(
        "connect to relay: HTTP error: 401 Unauthorized",
        false,
        t
      )
    ).toBe("mobileRemote.relayStatusCloudLoginRequired");
  });

  it("maps legacy desktop token config errors to cloud login guidance", () => {
    expect(
      formatMobileRemoteRelayStatusMessage(
        "desktop relay token must contain at least 24 characters",
        false,
        t
      )
    ).toBe("mobileRemote.relayStatusCloudLoginRequired");
  });

  it("maps legacy token failures to Cloud guidance for every relay", () => {
    expect(
      formatMobileRemoteRelayStatusMessage("invalid desktop token", false, t)
    ).toBe("mobileRemote.relayStatusCloudLoginRequired");
  });

  it("asks a signed-in user to refresh rejected Cloud credentials", () => {
    expect(
      formatMobileRemoteRelayStatusMessage("invalid desktop token", true, t)
    ).toBe("mobileRemote.relayStatusAuthFailedSignedIn");
  });
});
