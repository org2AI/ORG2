import type { Connection } from "./rpc";

export const MARKET_CONNECTION_OPEN_EVENT = "market-connection-open";
export const MARKET_PROFILES_CHANGED_EVENT = "market-profiles-changed";
export const MARKET_CONNECTION_ERROR_EVENT = "market-connection-error";

export type MarketConnectionOperation =
  | "begin-authorization"
  | "complete-authorization"
  | "load-profiles";

export type MarketConnectionErrorCode =
  | "secure-storage-unavailable"
  | "authorization-required"
  | "network-unavailable"
  | "local-state-unavailable"
  | "browser-open-failed"
  | "unexpected";

export interface MarketConnectionErrorDetail {
  code: MarketConnectionErrorCode;
  operation: MarketConnectionOperation;
  target?: Connection["target"];
}

export function classifyMarketConnectionError(
  error: unknown
): MarketConnectionErrorCode {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    /\b(?:market_buyer_credential_store_unavailable|credential_store_unavailable|native_credential_store_not_supported)\b/.test(
      message
    )
  )
    return "secure-storage-unavailable";
  if (
    /\b(?:market_reauthorization_required|credential_store_read_failed|invalid_connection_grant|invalid_stored_credential|credential_scope_mismatch)\b/.test(
      message
    )
  )
    return "authorization-required";
  if (
    /\b(?:market_request_failed|connection_exchange_failed|connection_transport_unavailable)\b/.test(
      message
    )
  )
    return "network-unavailable";
  if (
    /\b(?:market_connection_index_unavailable|market_connection_index_invalid|market_connection_index_too_large)\b/.test(
      message
    )
  )
    return "local-state-unavailable";
  if (/\bbrowser_open_failed\b/.test(message)) return "browser-open-failed";
  return "unexpected";
}

/**
 * Publish the connection change once at the deep-link boundary. Native ORG2
 * profiles are a projection of saved Market grants, so they receive a second,
 * domain-specific invalidation event instead of being routed through settings.
 */
export function dispatchMarketConnection(
  type: typeof MARKET_CONNECTION_OPEN_EVENT,
  connection: Connection
) {
  window.dispatchEvent(new CustomEvent(type, { detail: connection }));
  if (connection.target === "org2") {
    window.dispatchEvent(
      new CustomEvent(MARKET_PROFILES_CHANGED_EVENT, { detail: connection })
    );
  }
}

export function dispatchMarketConnectionError(
  error: unknown,
  operation: MarketConnectionOperation,
  target?: Connection["target"]
) {
  window.dispatchEvent(
    new CustomEvent<MarketConnectionErrorDetail>(
      MARKET_CONNECTION_ERROR_EVENT,
      {
        detail: {
          code: classifyMarketConnectionError(error),
          operation,
          ...(target ? { target } : {}),
        },
      }
    )
  );
}
