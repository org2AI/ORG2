/**
 * Local IDE server (the Rust HTTP server inside this app) endpoint config.
 *
 * Webpack's env value is the browser/test fallback. Desktop startup replaces
 * it from the identifier embedded in the running Tauri binary before the App
 * module graph is loaded, so a directly launched isolated executable always
 * talks to its own backend.
 */
import { runtimeInstanceProfileForIdentifier } from "./runtimeInstance";

export let IDE_SERVER_PORT = process.env.ORGII_IDE_SERVER_PORT ?? "13847";

export let IDE_SERVER_HTTP_URL = `http://localhost:${IDE_SERVER_PORT}`;

export let IDE_SERVER_WS_URL = `ws://localhost:${IDE_SERVER_PORT}/ws`;

function exposeIdeServerUrlForE2E(): void {
  if (typeof window === "undefined" || process.env.ORGII_E2E !== "1") return;
  (
    window as unknown as { __ORGII_E2E_IDE_SERVER_WS_URL__: string }
  ).__ORGII_E2E_IDE_SERVER_WS_URL__ = IDE_SERVER_WS_URL;
}

exposeIdeServerUrlForE2E();

/**
 * Per-launch token the local IDE server requires on every request. Desktop
 * startup reads it over IPC before the App module graph is loaded, the same
 * way it resolves the port. It stays empty in browser and unit-test builds,
 * which never reach that server.
 */
export let IDE_SERVER_TOKEN = "";

export const IDE_SERVER_TOKEN_HEADER = "x-orgii-token";

/** For `EventSource` and `WebSocket`, which cannot set request headers. */
export const IDE_SERVER_TOKEN_QUERY_PARAM = "orgii_token";

export function configureIdeServerToken(token: string): void {
  IDE_SERVER_TOKEN = token;
}

/** Headers to spread into every `fetch` that targets the local IDE server. */
export function ideServerAuthHeaders(): Record<string, string> {
  return IDE_SERVER_TOKEN
    ? { [IDE_SERVER_TOKEN_HEADER]: IDE_SERVER_TOKEN }
    : {};
}

/** Append the token to a local IDE server URL opened without headers. */
export function withIdeServerToken(url: string): string {
  if (!IDE_SERVER_TOKEN) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${IDE_SERVER_TOKEN_QUERY_PARAM}=${encodeURIComponent(IDE_SERVER_TOKEN)}`;
}

export function configureIdeServerForIdentifier(identifier: string): number {
  const { ideServerPort } = runtimeInstanceProfileForIdentifier(identifier);
  IDE_SERVER_PORT = String(ideServerPort);
  IDE_SERVER_HTTP_URL = `http://localhost:${IDE_SERVER_PORT}`;
  IDE_SERVER_WS_URL = `ws://localhost:${IDE_SERVER_PORT}/ws`;
  exposeIdeServerUrlForE2E();
  return ideServerPort;
}
