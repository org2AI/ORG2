/**
 * Unified Session API
 *
 * All sessions now run locally via Tauri/Rust engine. The hosted ORGII
 * proxy (when configured) handles billing only (allocate/release tokens);
 * the session lifecycle still runs through the local Rust-backed API.
 *
 * The "source=market" URL flag is the hosted-key entry point.
 */

export function isHostedFromSearchParams(
  searchParams: URLSearchParams
): boolean {
  return searchParams.get("source") === "market";
}
