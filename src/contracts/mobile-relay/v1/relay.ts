// Generated from mobile-relay-protocol. Do not edit; run scripts/mobile-relay/generate-contract.mjs.
export const DESKTOP_WS_PATH = "/v1/desktop/ws";
export const DEVICES_PATH = "/v1/devices";
export const DEVICE_REVOKE_PATH = "/v1/devices/revoke";
export const MAX_FRAME_BYTES = 1048576;
export const MOBILE_CONNECT_TICKET_PATH = "/v1/mobile/auth/connect-ticket";
export const MOBILE_WS_PATH = "/v1/mobile/ws";
export const PAIRINGS_PATH = "/v1/pairings";
export const PAIRING_COMPLETE_PATH = "/v1/pairings/complete";
export const PRIMARY_DESKTOP_PATH = "/v1/desktops/primary";
export const RELAY_PROTOCOL_VERSION = 1;
export type MobileConnectTicketRequest = {
  desktopId: string;
  deviceToken: string;
  pairingCode?: string;
};
export type MobileConnectTicketResponse = {
  authExpiresAtMs: number;
  expiresAtMs: number;
  ticket: string;
};
export type PairedDeviceInfo = {
  desktopId: string;
  deviceId: string;
  isPrimary: boolean;
  label: string;
  lastSeenMs: number | null;
  pairedAtMs: number;
  tier: PermissionTier;
};
export type PairingCompleteRequest = {
  pairingCode: string;
  tier: PermissionTier;
};
export type PairingInitRequest = {
  desktopId: string;
  isPrimary?: boolean;
  label: string;
  tier: PermissionTier;
};
export type PairingInitResponse = {
  confirmationPhrase: string;
  expiresInSeconds: number;
  pairingCode: string;
  qrPayload: string;
};
export type PermissionTier = "read_only" | "full";
export type RelayWireFrame =
  | { desktop_id: string; protocol_version: number; type: "desktop_registered" }
  | {
      connection_id: string;
      device: PairedDeviceInfo;
      type: "mobile_connected";
    }
  | { connection_id: string; type: "mobile_disconnected" }
  | { connection_id: string; payload: unknown; type: "mobile_frame" }
  | { connection_id: string; payload: unknown; type: "desktop_frame" }
  | { code: string; message: string; type: "error" };
export type RevokeDeviceRequest = { deviceId: string };
export type SetPrimaryDesktopRequest = { desktopId: string };
