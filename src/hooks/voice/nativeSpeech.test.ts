// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { isNativeIosSpeechRuntime } from "./nativeSpeech";

vi.mock("@src/util/platform/isIOS", () => ({
  isIOS: () => false,
}));

describe("isNativeIosSpeechRuntime", () => {
  const originalBuildFlag = process.env.ORGII_MOBILE_REMOTE_NATIVE;

  afterEach(() => {
    if (originalBuildFlag === undefined) {
      delete process.env.ORGII_MOBILE_REMOTE_NATIVE;
    } else {
      process.env.ORGII_MOBILE_REMOTE_NATIVE = originalBuildFlag;
    }
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("uses the native speech path for the dedicated iOS bundle even when the webview user agent is desktop-like", () => {
    process.env.ORGII_MOBILE_REMOTE_NATIVE = "true";
    (
      window as unknown as {
        __TAURI_INTERNALS__?: Record<string, never>;
      }
    ).__TAURI_INTERNALS__ = {};

    expect(isNativeIosSpeechRuntime()).toBe(true);
  });
});
