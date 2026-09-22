import { describe, expect, it, vi } from "vitest";

import { APP_LOCK_ERROR } from "@src/api/tauri/appLock";

import { appLockErrorMessageKey, validateNewPassword } from "../AppLockSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("validateNewPassword", () => {
  it("requires the minimum length, counted in characters like the backend", () => {
    expect(validateNewPassword("abc", "abc")).toBe("appLock.errors.tooShort");
    expect(validateNewPassword("abcd", "abcd")).toBeNull();
    // Four CJK characters are four characters, whatever their byte length.
    expect(validateNewPassword("密码锁屏", "密码锁屏")).toBeNull();
    // One emoji is one character even though it is two UTF-16 units.
    expect(validateNewPassword("🔒🔒🔒", "🔒🔒🔒")).toBe(
      "appLock.errors.tooShort"
    );
  });

  it("requires the confirmation to match", () => {
    expect(validateNewPassword("abcd", "abce")).toBe("appLock.errors.mismatch");
  });
});

describe("appLockErrorMessageKey", () => {
  it("maps each backend code to its own message", () => {
    expect(appLockErrorMessageKey(APP_LOCK_ERROR.INVALID_PASSWORD)).toBe(
      "appLock.errors.incorrectCurrent"
    );
    expect(appLockErrorMessageKey(APP_LOCK_ERROR.THROTTLED)).toBe(
      "appLock.errors.throttled"
    );
    expect(appLockErrorMessageKey(APP_LOCK_ERROR.PASSWORD_TOO_SHORT)).toBe(
      "appLock.errors.tooShort"
    );
    expect(appLockErrorMessageKey(APP_LOCK_ERROR.PASSWORD_TOO_LONG)).toBe(
      "appLock.errors.tooLong"
    );
    expect(appLockErrorMessageKey(APP_LOCK_ERROR.HINT_TOO_LONG)).toBe(
      "appLock.errors.hintTooLong"
    );
    expect(appLockErrorMessageKey(APP_LOCK_ERROR.HINT_REVEALS_PASSWORD)).toBe(
      "appLock.errors.hintRevealsPassword"
    );
  });

  it("falls back to a generic message instead of echoing unknown errors", () => {
    expect(appLockErrorMessageKey("app_lock:write_failed: disk full")).toBe(
      "appLock.errors.generic"
    );
    expect(appLockErrorMessageKey(new Error("boom"))).toBe(
      "appLock.errors.generic"
    );
  });
});
