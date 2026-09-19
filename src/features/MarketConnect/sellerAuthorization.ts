/** App-owned authorization. A website shortcut carries selection, never consent or credentials. */
import { z } from "zod/v4";

import {
  RpcError,
  defineProcedure,
  typedInvoke,
} from "@src/api/tauri/rpc/invoke";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { withFreshMarketOwner } from "./auth";
import { type MarketStore, captureMarketOwner } from "./identity";
import { marketConsoleUrl } from "./urlPolicy";

const logger = createLogger("MarketSeller");
const diagnosticCodes = new Set([
  "market_reauthorization_required",
  "market_identity_mismatch",
  "market_identity_changed",
  "market_cloud_sign_in_required",
  "market_cloud_verification_unavailable",
  "market_request_failed",
  "invalid_seller_authorization",
  "seller_connection_cancelled",
  "seller_connection_in_progress",
  "seller_exchange_failed",
  "invalid_seller_grant",
  "seller_operation_uncertain",
  "seller_operation_failed",
  "invalid_seller_start",
  "seller_callback_unavailable",
  "seller_browser_open_failed",
]);

const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const selection = z.strictObject({
  provider: z.enum(["claude", "codex"]),
  region: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
});
const proof = selection.extend({ state: nonce, challenge: nonce });
const approval = z.strictObject({
  code: nonce,
  state: nonce,
  expires_at: z.iso.datetime(),
});
const binding = z.strictObject({
  binding_id: z.string().min(1).max(256),
  auth_id: z.string().min(1).max(256),
});
const begin = defineProcedure("market_seller_begin")
  .input(selection)
  .output(proof)
  .build();
const complete = defineProcedure("market_seller_complete")
  .input(
    z.object({
      code: nonce,
      state: nonce,
      expectedIdentityUserId: z.string().uuid(),
    })
  )
  .output(binding)
  .build();
const cancel = defineProcedure("market_seller_cancel").build();
const flights = new WeakSet<MarketStore>();

async function readApproval(response: Response) {
  if (!response.ok)
    throw Error(`market_request_failed_http_${response.status}`);
  if (!response.body) throw Error("invalid_seller_authorization");
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
        throw Error("invalid_seller_authorization");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return approval.parse(JSON.parse(text + decoder.decode()));
  } catch {
    throw Error("invalid_seller_authorization");
  } finally {
    reader.releaseLock();
  }
}

export async function connectSellerAccount(
  provider: "claude" | "codex",
  signal: AbortSignal,
  store: MarketStore = getInstrumentedStore(),
  region = "sjc"
) {
  if (flights.has(store)) throw Error("seller_connection_in_progress");
  flights.add(store);
  const controller = new AbortController();
  let cancellation: Promise<unknown> | undefined;
  let started = false;
  let completed = false;
  let stage = "identity";
  const stop = () => {
    controller.abort();
    if (started)
      cancellation ??= typedInvoke(cancel, undefined).catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  let owner: ReturnType<typeof captureMarketOwner> | undefined;
  try {
    const auth = store.get(org2CloudAuthAtom);
    if (!auth?.oauthClientId) throw Error("market_reauthorization_required");
    owner = captureMarketOwner(auth.userId, store, stop);
    const check = () => {
      owner!.assertCurrent();
      if (signal.aborted || controller.signal.aborted)
        throw Error("seller_connection_cancelled");
    };
    return await withFreshMarketOwner(
      async () => {
        check();
        const fresh = store.get(org2CloudAuthAtom);
        if (!fresh?.oauthClientId)
          throw Error("market_reauthorization_required");
        stage = "begin";
        const request = await typedInvoke(begin, { provider, region });
        started = true;
        check();
        if (request.provider !== provider || request.region !== region)
          throw Error("invalid_seller_authorization");
        stage = "authorize";
        const response = await fetch(
          marketConsoleUrl("/api/auth/native/seller/authorize-desktop"),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${fresh.accessToken}`,
            },
            body: JSON.stringify(request),
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
        const result = await readApproval(response);
        check();
        const remaining = Date.parse(result.expires_at) - Date.now();
        if (
          result.state !== request.state ||
          remaining <= 0 ||
          remaining > 91_000
        )
          throw Error("invalid_seller_authorization");
        stage = "native_complete";
        const connected = await typedInvoke(complete, {
          code: result.code,
          state: result.state,
          expectedIdentityUserId: auth.userId,
        });
        check();
        completed = true;
        return connected;
      },
      auth.userId,
      store,
      controller.signal
    );
  } catch (error) {
    const cause = error instanceof RpcError ? error.cause : error;
    const message = cause instanceof Error ? cause.message : cause;
    const code =
      typeof message === "string" &&
      (diagnosticCodes.has(message) ||
        /^market_request_failed_http_[45][0-9]{2}$/.test(message))
        ? message
        : "seller_request_failed";
    logger.warn(`Seller authorization failed at ${stage}: ${code}`);
    throw error;
  } finally {
    if (!completed) stop();
    await cancellation;
    owner?.dispose();
    signal.removeEventListener("abort", stop);
    flights.delete(store);
  }
}
