/** Market's PKCE proof travels over HTTPS after Cloud login, without a second browser handoff. */
import { z } from "zod/v4";

import { getCloudEndpoint } from "@src/features/Org2Cloud/config";
import { refreshOrg2CloudAuthForAction } from "@src/features/Org2Cloud/org2CloudAuthAction";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import type { MarketStore } from "./identity";
import { isTrustedMarketPage, marketConsoleUrl } from "./urlPolicy";

const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const proofSchema = z.strictObject({
  workspace_id: z.string().regex(/^ws_[A-Za-z0-9_-]{1,120}$/),
  target: z.literal("org2"),
  state: nonce,
  challenge: nonce,
});
const codeSchema = z.strictObject({
  code: nonce,
  state: nonce,
  expires_at: z.iso.datetime(),
});

async function readCode(response: Response) {
  // Error pages and server payloads are never included in diagnostics.
  if (!response.ok)
    throw Error(`market_request_failed_http_${response.status}`);
  if (!response.body) throw Error("invalid_market_authorization_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw Error("invalid_market_authorization_response");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const parsed = codeSchema.safeParse(JSON.parse(text + decoder.decode()));
    if (!parsed.success) throw Error("invalid_market_authorization_response");
    return parsed.data;
  } catch {
    throw Error("invalid_market_authorization_response");
  } finally {
    reader.releaseLock();
  }
}

export async function authorizeMarketInBackground(options: {
  store?: MarketStore;
  authorization: URL;
  selection: URL;
  auth: Org2CloudAuthState;
  complete: (raw: string, isCurrent: () => boolean) => Promise<void>;
  cancel: () => Promise<void>;
}): Promise<void> {
  const { authorization, selection, auth } = options;
  const store = options.store ?? getInstrumentedStore();
  const endpoint = getCloudEndpoint();
  const controller = new AbortController();
  let cancellation: Promise<void> | undefined;
  let completed = false;
  const cancel = () => {
    controller.abort();
    cancellation ??= options.cancel().catch(() => {});
  };
  const current = () => {
    const latest = store.get(org2CloudAuthAtom);
    const configured = getCloudEndpoint();
    return (
      !controller.signal.aborted &&
      configured.isOfficial &&
      configured.supabaseUrl === endpoint.supabaseUrl &&
      configured.webOrigin === endpoint.webOrigin &&
      configured.anonKey === endpoint.anonKey &&
      latest?.userId === auth.userId &&
      latest.supabaseUrl === auth.supabaseUrl &&
      auth.supabaseUrl === endpoint.supabaseUrl
    );
  };
  const assertCurrent = () => {
    if (!current()) throw Error("market_identity_mismatch");
  };
  const unwatch = store.sub(org2CloudAuthAtom, () => {
    if (!current()) cancel();
  });
  try {
    assertCurrent();
    if (!isTrustedMarketPage(authorization, "/buyer/connect/authorize"))
      throw Error("invalid_authorization_destination");
    const pairs = [...authorization.searchParams.entries()];
    const proof = proofSchema.safeParse(Object.fromEntries(pairs));
    if (
      pairs.length !== 4 ||
      !proof.success ||
      proof.data.workspace_id !== selection.searchParams.get("workspace_id")
    )
      throw Error("invalid_market_connection_link");
    const fresh = await refreshOrg2CloudAuthForAction(auth, (update) =>
      store.set(org2CloudAuthAtom, update)
    );
    assertCurrent();
    if (fresh.status !== "ready" || !fresh.auth.oauthClientId)
      throw Error("market_reauthorization_required");
    const response = await fetch(
      marketConsoleUrl("/api/auth/native/authorize-desktop"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${fresh.auth.accessToken}`,
        },
        body: JSON.stringify(proof.data),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      }
    ).catch(() => {
      throw Error("market_request_failed");
    });
    const result = await readCode(response);
    assertCurrent();
    const remaining = Date.parse(result.expires_at) - Date.now();
    if (
      result.state !== proof.data.state ||
      remaining <= 0 ||
      remaining > 91_000
    )
      throw Error("invalid_market_authorization_response");
    // This URL is an internal input to the existing Rust verifier, never opened.
    const callback = new URL(selection);
    callback.pathname = "/authorized";
    callback.search = new URLSearchParams({
      code: result.code,
      state: result.state,
    }).toString();
    callback.hash = "";
    await options.complete(callback.toString(), current);
    assertCurrent();
    completed = true;
  } finally {
    unwatch();
    if (!completed) cancel();
    await cancellation;
  }
}
