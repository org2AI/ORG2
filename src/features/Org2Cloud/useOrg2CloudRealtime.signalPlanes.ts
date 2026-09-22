/**
 * useOrg2CloudRealtime — shared signal-plane vocabulary and constants.
 */

/**
 * Per-org change-signal table (schema `org2_cloud`) for Slice B:
 * `org_change_signals`, defined in the consolidated baseline with
 * `REPLICA IDENTITY FULL`, membership in `supabase_realtime`, and an
 * `is_org_member(org_id)` SELECT policy — the row-level authorization
 * Realtime needs. Server triggers bump one row per org on
 * projects / work-items / comments / SESSIONS changes (session-row
 * writes were verified to broadcast on 2026-08-06 — an earlier version
 * of this comment under-claimed the coverage).
 */
export const CHANGE_SIGNALS_TABLE = "org_change_signals";

/**
 * The backend's durable signal is intentionally coarse. Plane-specific
 * Presence broadcasts provide the live path; the durable coarse row is a
 * secondary event source. A short leading/trailing window coalesces
 * transaction bursts without delaying a teammate notification. It does not
 * schedule polling when no signal arrives.
 */
export const CONTROL_PLANE_REFRESH_THROTTLE_MS = 5 * 60_000;

/**
 * Throttle keys for the trailing-edge signal refreshes: one per narrowed
 * dispatch target ("inbound" covers projects + workItems, which run the same
 * action) plus "coarse" for the legacy all-planes refresh.
 */
export type SignalPlane =
  | "coarse"
  | "sessions"
  | "comments"
  | "inbound"
  | "roster"
  | "policy"
  | "channels"
  | "channelMessages"
  | "memberRuntime"
  | "conversationEvents";

export const ALL_SIGNAL_PLANES: readonly SignalPlane[] = [
  "coarse",
  "sessions",
  "comments",
  "inbound",
  "roster",
  "policy",
  "channels",
  "channelMessages",
  "memberRuntime",
  "conversationEvents",
];

export function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}
