/**
 * App lock IPC — thin wrappers over the `app_lock_*` Tauri commands.
 *
 * The lock itself (password digest, locked flag, throttling, idle auto-lock)
 * is owned by Rust in `system_services::app_lock`; this file only moves
 * values across the boundary.
 *
 * These calls deliberately bypass the zod-validating `rpc` layer: its failure
 * paths stringify what they were given, and a password must never be able to
 * reach a log line or an error message.
 */
import { invoke } from "@tauri-apps/api/core";

export const APP_LOCK_CHANGED_EVENT = "app-lock:changed";

/** Auto-lock delays Rust accepts, in minutes. `0` means never. */
export const APP_LOCK_AUTO_LOCK_MINUTES = [0, 1, 5, 15, 30, 60] as const;
export type AppLockAutoLockMinutes =
  (typeof APP_LOCK_AUTO_LOCK_MINUTES)[number];

export const APP_LOCK_MIN_PASSWORD_LENGTH = 4;
export const APP_LOCK_MAX_PASSWORD_LENGTH = 256;
export const APP_LOCK_MAX_HINT_LENGTH = 120;

export interface AppLockStatus {
  /** A password is set. */
  enabled: boolean;
  locked: boolean;
  lockOnLaunch: boolean;
  autoLockMinutes: number;
  /** Password hint shown on the lock page; `null` when none is set. */
  hint: string | null;
  /** Milliseconds until another password attempt is accepted; 0 when none. */
  retryAfterMs: number;
}

export interface AppLockUnlockOutcome {
  unlocked: boolean;
  status: AppLockStatus;
}

/** Stable error codes returned by the Rust commands. */
export const APP_LOCK_ERROR = {
  NOT_ENABLED: "app_lock:not_enabled",
  LOCKED: "app_lock:locked",
  INVALID_PASSWORD: "app_lock:invalid_password",
  THROTTLED: "app_lock:throttled",
  PASSWORD_TOO_SHORT: "app_lock:password_too_short",
  PASSWORD_TOO_LONG: "app_lock:password_too_long",
  INVALID_AUTO_LOCK: "app_lock:invalid_auto_lock",
  HINT_TOO_LONG: "app_lock:hint_too_long",
  HINT_REVEALS_PASSWORD: "app_lock:hint_reveals_password",
} as const;

export type AppLockErrorCode =
  (typeof APP_LOCK_ERROR)[keyof typeof APP_LOCK_ERROR];

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(APP_LOCK_ERROR)
);

/**
 * Extract the stable code from a rejected command. Anything else (an I/O
 * failure writing the lock file, a panicked task) returns `null` so callers
 * fall back to a generic message instead of guessing.
 */
export function appLockErrorCode(error: unknown): AppLockErrorCode | null {
  const text = typeof error === "string" ? error : null;
  return text && KNOWN_ERROR_CODES.has(text)
    ? (text as AppLockErrorCode)
    : null;
}

export const appLockApi = {
  status: () => invoke<AppLockStatus>("app_lock_status"),

  /** Sets or changes the password; `hint` replaces any existing hint. */
  setPassword: (
    newPassword: string,
    options: { currentPassword?: string; hint?: string } = {}
  ) =>
    invoke<AppLockStatus>("app_lock_set_password", {
      currentPassword: options.currentPassword ?? null,
      newPassword,
      hint: options.hint ?? null,
    }),

  /** Replaces the hint; an empty string removes it. */
  setHint: (hint: string) =>
    invoke<AppLockStatus>("app_lock_set_hint", { hint }),

  clearPassword: (currentPassword: string) =>
    invoke<AppLockStatus>("app_lock_clear_password", { currentPassword }),

  updatePreferences: (lockOnLaunch: boolean, autoLockMinutes: number) =>
    invoke<AppLockStatus>("app_lock_update_preferences", {
      lockOnLaunch,
      autoLockMinutes,
    }),

  lock: () => invoke<AppLockStatus>("app_lock_lock"),

  unlock: (password: string) =>
    invoke<AppLockUnlockOutcome>("app_lock_unlock", { password }),

  reportActivity: () => invoke<void>("app_lock_report_activity"),
};
