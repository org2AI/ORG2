import type { SystemColorScheme } from "@src/config/appearance/globalThemes";

import type { MobileAuthClient } from "../auth/mobileAuthClient";
import type { MobileAuthSession } from "../auth/mobileAuthState";
import type {
  MobileConnectionConfig,
  MobilePairedDesktopSummary,
} from "../connection/types";

export type MobileRemoteIntentEvent = "auth_callback" | "pairing";

export interface MobileRemoteRuntimePort {
  readPreference?(key: string): string | null;
  writePreference?(key: string, value: string): void;
  now(): number;
  random(): number;
  randomUUID(): string;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number): void;
  isHidden(): boolean;
  subscribeVisibility(listener: () => void): () => void;
  /**
   * Overlay host for floating surfaces. Returns null when the shell has no
   * mounted container yet, in which case the caller renders nothing.
   */
  portalContainer(): Element | null;
}

export interface MobileRemoteAppearancePort {
  getSystemColorScheme(): SystemColorScheme;
  subscribeSystemColorScheme(
    listener: (colorScheme: SystemColorScheme) => void
  ): () => void;
  applyColorScheme(colorScheme: SystemColorScheme): void | Promise<void>;
}

export interface MobileRemoteAuthPort {
  createClient(): MobileAuthClient;
  captureInitialPairingIntent(): string | null;
  isCallback(): boolean;
  currentUrl(): string;
  callbackUrl(): string;
  scrubCallback(): void;
  beginOAuthAttempt(attemptId: string): Promise<void>;
  consumeOAuthAttempt(): Promise<boolean>;
  consumePairingIntent(): Promise<string | null>;
  clearIntents(): Promise<void>;
  readSession(): Promise<MobileAuthSession | null>;
  writeSession(session: MobileAuthSession): Promise<void>;
  clearSession(): Promise<void>;
  /** Native shells notify warm OAuth callbacks and pairing deep links here. */
  subscribeIntent(
    listener: (event: MobileRemoteIntentEvent) => void
  ): () => void;
}

export interface MobileRemoteConnectionPort {
  /** Shell-specific authentication; the shared app never assembles a ticket. */
  prepareSocketUrl(
    config: MobileConnectionConfig,
    context: {
      authUserId: string;
      signal: AbortSignal;
      getSession(): Promise<MobileAuthSession>;
    }
  ): Promise<string>;
  createSocket(url: string): WebSocket;
  load(userId: string): Promise<MobileConnectionConfig | null>;
  listPairedDesktops(userId: string): Promise<MobilePairedDesktopSummary[]>;
  selectPairedDesktop(
    userId: string,
    desktopId: string
  ): Promise<MobileConnectionConfig | null>;
  /** Implementations must serialize writes so the latest invocation wins. */
  save(userId: string, config: MobileConnectionConfig | null): Promise<void>;
}

/**
 * The shared Remote application depends on this port rather than browser or
 * Tauri globals. Platform shells own credentials, navigation and lifecycle.
 */
export interface MobileRemotePlatform {
  /** Optional for alternate shells without clipboard access; invoked by user gesture only. */
  writeClipboardText?(text: string): Promise<void>;
  /** User-initiated, one-shot scan. Aborting must release the camera. */
  scanQr?(video: HTMLVideoElement, signal: AbortSignal): Promise<string>;
  /** Opens an external page using the shell's navigation implementation. */
  openExternal(url: string): void | Promise<void>;
  readonly kind: "browser" | "ios";
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
    readonly defaultDeviceLabel: string;
  };
  readonly runtime: MobileRemoteRuntimePort;
  /** Optional only for lightweight test/alternate shells; production adapters provide it. */
  readonly appearance?: MobileRemoteAppearancePort;
  readonly auth: MobileRemoteAuthPort;
  readonly connection: MobileRemoteConnectionPort;
}
