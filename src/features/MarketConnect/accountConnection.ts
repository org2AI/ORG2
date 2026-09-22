/** Account discovery uses the signed-in desktop identity, never a browser handoff. */
import { z } from "zod/v4";

import {
  RpcError,
  defineProcedure,
  typedInvoke,
} from "@src/api/tauri/rpc/invoke";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { authorizeMarketInBackground } from "./backgroundAuthorization";
import { type MarketStore, captureMarketOwner } from "./identity";

const logger = createLogger("MarketAccount");

const input = z.object({ raw: z.string().max(2048) });
const begin = defineProcedure("market_connection_begin")
  .input(input)
  .output(z.string().url())
  .build();
const complete = defineProcedure("market_connection_complete")
  .input(input.extend({ expectedIdentityUserId: z.string() }))
  .output(
    z.object({
      identity_user_id: z.string().uuid(),
      workspace_id: z.string(),
      target: z.literal("org2"),
      phase: z.literal("authorization_saved"),
    })
  )
  .build();
const cancel = defineProcedure("market_connection_cancel").build();
const flights = new WeakMap<MarketStore, Promise<void>>();

export async function authorizeMarketAccount(
  appScheme: string,
  store: MarketStore = getInstrumentedStore()
): Promise<void> {
  const previous = flights.get(store);
  if (previous) return previous;
  const task = (async () => {
    const auth = store.get(org2CloudAuthAtom);
    if (!auth?.oauthClientId) throw Error("market_reauthorization_required");
    const owner = captureMarketOwner(auth.userId, store);
    let stage = "begin";
    let started = false;
    let completed = false;
    try {
      if (!/^orgii(?:-market-local-[a-f0-9]{8})?$/.test(appScheme))
        throw Error("invalid_market_app_scheme");
      // The marker resolves server-side to this identity's account catalog.
      // This URL is only the Rust enrollment input; it is never opened by the OS.
      const selection = new URL(
        `${appScheme}://market/connect?workspace_id=ws_account&target=org2`
      );
      const authorization = new URL(
        await typedInvoke(begin, { raw: selection.toString() })
      );
      started = true;
      owner.assertCurrent();
      stage = "authorize";
      await authorizeMarketInBackground({
        authorization,
        selection,
        auth,
        store,
        cancel: () => typedInvoke(cancel),
        complete: async (raw, isCurrent) => {
          owner.assertCurrent();
          if (!isCurrent()) throw Error("market_identity_mismatch");
          stage = "complete";
          const saved = await typedInvoke(complete, {
            raw,
            expectedIdentityUserId: auth.userId,
          });
          owner.assertCurrent();
          if (!isCurrent() || saved.identity_user_id !== auth.userId)
            throw Error("market_identity_mismatch");
        },
      });
      completed = true;
    } catch (error) {
      // Only bounded diagnostic codes; never tokens, URLs or response bodies.
      const cause = error instanceof RpcError ? error.cause : error;
      const message = cause instanceof Error ? cause.message : cause;
      const code =
        typeof message === "string" &&
        /^(?:market|invalid|secure|native|connection|credential|no_pending)_[a-z0-9_]{1,80}$/.test(
          message
        )
          ? message
          : "request_failed";
      logger.warn(`Account discovery failed at ${stage}: ${code}`);
      throw error;
    } finally {
      owner.dispose();
      if (started && !completed)
        await typedInvoke(cancel).catch(() => undefined);
    }
  })();
  flights.set(store, task);
  try {
    await task;
  } finally {
    if (flights.get(store) === task) flights.delete(store);
  }
}
