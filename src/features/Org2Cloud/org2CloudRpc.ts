/**
 * The one PostgREST RPC call every throwing org2 cloud client makes.
 *
 * Eleven clients had independently grown the identical block: POST to
 * `${supabaseUrl}/rest/v1/rpc/${fn}` with `apikey` + JWT Bearer +
 * `Content-Profile: org2_cloud` (no supabase-js), read the body as text,
 * `JSON.parse` it behind a try/catch so a non-JSON error page degrades to
 * `null` instead of masking the HTTP status, and on a non-2xx throw the
 * server's `message` — falling back to `org2_cloud rpc <fn> failed with
 * <status>` — as that client's own typed error.
 *
 * What stays with the caller, because it genuinely differs per client:
 *
 * - **the error class** (`createError`): each client's wrappers reject with
 *   their own `Error` subclass, and callers narrow on `instanceof` plus a
 *   client-specific `ORG2_*` code list. This helper never invents an error
 *   type of its own.
 * - **the endpoint** (`endpoint`): org-sharded clients resolve it through
 *   `endpointForOrg(orgId)`; the rest default to `getCloudEndpoint()`.
 * - **the deadline** (`timeoutMs`): some clients bound the call, some
 *   deliberately do not. Omitted means unbounded, exactly as before.
 * - **the bearer** (`accessToken`): omitting it sends NO `authorization`
 *   header at all — the anon-key-only capability path used by the
 *   registered-link replay authorize RPC, which must not send anon-as-bearer.
 *
 * Non-goals: `org2CloudClient.callRpc` (returns `null` instead of throwing,
 * and logs before reading the body) and `sharedSessionFilesClient.rpc`
 * (`response.json()`, its own 30s controller, its own user-facing message)
 * are NOT expressible here and keep their own implementations.
 */
import {
  type CloudEndpoint,
  ORG2_CLOUD_POSTGREST_SCHEMA,
  getCloudEndpoint,
} from "./config";
import {
  fetchWithTransportRetry,
  runCloudRequestWithTimeout,
} from "./org2CloudFetchRetry";

/** Only the two fields an RPC request needs, so callers may pass a subset. */
export type Org2CloudRpcEndpoint = Pick<
  CloudEndpoint,
  "supabaseUrl" | "anonKey"
>;

export interface Org2CloudRpcOptions {
  /**
   * Builds the rejection for a non-2xx response from the server's message
   * (or the generated fallback) and the HTTP status.
   */
  createError: (message: string, status: number) => Error;
  /**
   * Bearer JWT. Omit for an anon-key-only RPC: the `authorization` header is
   * then not sent at all, rather than carrying the anon key as a bearer.
   */
  accessToken?: string;
  /** Defaults to `getCloudEndpoint()`; sharded orgs pass their home project. */
  endpoint?: Org2CloudRpcEndpoint;
  /**
   * Bounds the whole call — fetch AND body read — through
   * `runCloudRequestWithTimeout`. Omitted leaves the call unbounded.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * POST `body` to the `org2_cloud` RPC `functionName` and resolve its decoded
 * JSON payload (`null` for an empty or unparseable body).
 *
 * Rejects with `createError(message, status)` on any non-2xx response, and
 * propagates transport/abort/timeout failures untouched.
 */
export async function callOrg2CloudRpc(
  functionName: string,
  body: Record<string, unknown>,
  options: Org2CloudRpcOptions
): Promise<unknown> {
  const { accessToken, createError, timeoutMs, signal } = options;
  const endpoint = options.endpoint ?? getCloudEndpoint();

  const execute = async (requestSignal?: AbortSignal): Promise<unknown> => {
    const response = await fetchWithTransportRetry(
      `${endpoint.supabaseUrl}/rest/v1/rpc/${functionName}`,
      {
        method: "POST",
        headers: {
          apikey: endpoint.anonKey,
          ...(accessToken === undefined
            ? {}
            : { authorization: `Bearer ${accessToken}` }),
          "content-type": "application/json",
          "content-profile": ORG2_CLOUD_POSTGREST_SCHEMA,
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      }
    );

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message: unknown }).message)
          : `org2_cloud rpc ${functionName} failed with ${response.status}`;
      throw createError(message, response.status);
    }
    return payload;
  };

  if (timeoutMs === undefined) return execute(signal);
  return runCloudRequestWithTimeout(execute, timeoutMs, signal);
}
