/**
 * Error model + RPC plumbing shared by every `org2CloudSyncClient.*` wrapper.
 *
 * Same raw-fetch idiom as `org2CloudClient` (JWT Bearer + `Content-Profile:
 * org2_cloud`, no supabase-js), but UNLIKE that client these wrappers THROW on
 * failure — the sync engine needs the server's error codes to drive its OCC
 * re-anchor and backoff paths.
 */
import { type CloudEndpoint, getCloudEndpoint } from "./config";
import { callOrg2CloudRpc } from "./org2CloudRpc";

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

export const ORG2_SYNC_ERROR_CODES = [
  "ORG2_CONFLICT",
  "ORG2_QUOTA_EXCEEDED",
  "ORG2_SYNC_DISABLED",
  "ORG2_FORBIDDEN",
  "ORG2_RETENTION_EXPIRED",
  // Access ladder (§B): segment read refused (metadata_only / restricted).
  "ORG2_REPLAY_NOT_AVAILABLE",
  // Row absent (never pushed / already tombstoned) — callers that retract
  // opportunistically treat this as success.
  "ORG2_SESSION_NOT_FOUND",
  // Carries a suffix: `ORG2_SCOPE_COOLDOWN <ISO frees-at>` — parse it with
  // `parseScopeCooldownFreesAt` (org2CloudScopeQuota).
  "ORG2_SCOPE_COOLDOWN",
] as const;

export type Org2SyncErrorCode = (typeof ORG2_SYNC_ERROR_CODES)[number];

/** RPC failure carrying the server's error code when recognizable. */
export class Org2CloudSyncError extends Error {
  readonly code: Org2SyncErrorCode | null;
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "Org2CloudSyncError";
    this.status = status;
    this.code =
      ORG2_SYNC_ERROR_CODES.find((code) => message.includes(code)) ?? null;
  }
}

export function isOrg2SyncErrorCode(
  error: unknown,
  code: Org2SyncErrorCode
): boolean {
  return error instanceof Org2CloudSyncError && error.code === code;
}

// ---------------------------------------------------------------------------
// RPC plumbing (throwing variant of the org2CloudClient idiom)
// ---------------------------------------------------------------------------

export async function callSyncRpc(
  functionName: string,
  accessToken: string,
  body: Record<string, unknown>,
  endpoint: CloudEndpoint = getCloudEndpoint(),
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<unknown> {
  // Unlike the other clients this one refuses an already-aborted request
  // before it reaches the transport at all: the sync engine cancels in-flight
  // batches and must not emit a dead POST on the way down.
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  return callOrg2CloudRpc(functionName, body, {
    accessToken,
    endpoint,
    signal,
    timeoutMs,
    createError: (message, status) => new Org2CloudSyncError(message, status),
  });
}

/**
 * True when the backend rejected the call because it has no function with this
 * signature — the progressive-enhancement probe every `*UnsupportedEndpoints`
 * cache keys off.
 */
export function isRpcSignatureUnsupported(error: unknown): boolean {
  return (
    error instanceof Org2CloudSyncError &&
    error.status === 404 &&
    /could not find the function/i.test(error.message)
  );
}
