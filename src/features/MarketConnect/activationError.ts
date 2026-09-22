import { RpcError } from "@src/api/tauri/rpc/invoke";

const codes = new Set([
  "model_temporarily_unavailable",
  "usage_authorization_cancelled",
  "usage_authorization_in_progress",
  "market_identity_changed",
  "market_identity_mismatch",
  "market_reauthorization_required",
  "market_cloud_sign_in_required",
  "market_cloud_verification_unavailable",
  "insufficient_funds",
  "package_unavailable",
  "invalid_managed_access",
  "connection_transport_unavailable",
]);
/** Never forward raw RPC details, URLs or credential-bearing errors to logs. */
export function marketActivationErrorCode(error: unknown): string {
  const cause = error instanceof RpcError ? error.cause : error;
  const value = cause instanceof Error ? cause.message : cause;
  return typeof value === "string" && codes.has(value)
    ? value
    : "market_activation_failed";
}
