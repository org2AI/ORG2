import { openUrl } from "@tauri-apps/plugin-opener";
import { z } from "zod/v4";

import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";

const input = z.object({ raw: z.string().max(2048) });
const begin = defineProcedure("market_seller_begin")
  .input(input)
  .output(z.string().url())
  .build();
const complete = defineProcedure("market_seller_complete")
  .input(input)
  .output(
    z.object({ binding_id: z.string().min(1), auth_id: z.string().min(1) })
  )
  .build();
const cancel = defineProcedure("market_seller_cancel").build();
export type SellerPhase =
  | "approval"
  | "connecting"
  | "completed"
  | "failed"
  | "cancelling"
  | null;
let phase: SellerPhase = null;
const listeners = new Set<() => void>();
const update = (next: SellerPhase) => {
  phase = next;
  listeners.forEach((fn) => fn());
};
export const sellerSnapshot = () => phase;
export const subscribeSeller = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
let busy = false;
let queued: string | undefined;
export async function closeSeller() {
  if (phase === "completed" || phase === "failed") {
    update(null);
    return;
  }
  if (phase === "cancelling") return;
  queued = undefined;
  update("cancelling");
  try {
    await typedInvoke(cancel);
    if (!busy) update(null);
  } catch {
    update("failed");
  }
}
export function handleSellerLink(raw: string, url: URL): boolean {
  if (!url.pathname.startsWith("/seller/")) return false;
  if (busy) {
    if (
      raw.length <= 2048 &&
      url.pathname === "/seller/authorized" &&
      phase !== "connecting" &&
      phase !== "cancelling"
    )
      queued ??= raw;
    return true;
  }
  if (
    url.pathname === "/seller/connect" &&
    phase &&
    phase !== "failed" &&
    phase !== "completed"
  )
    return true;
  busy = true;
  (async () => {
    try {
      if (url.pathname === "/seller/connect") {
        const destination = new URL(await typedInvoke(begin, { raw }));
        try {
          if (phase === "cancelling") {
            await typedInvoke(cancel);
            return;
          }
          if (
            destination.origin !== "https://market.org2.dev" ||
            destination.pathname !== "/seller/accounts/authorize" ||
            destination.username ||
            destination.password ||
            destination.hash
          )
            throw new Error();
          update("approval");
          await openUrl(destination.toString());
        } catch {
          await typedInvoke(cancel);
          throw new Error();
        }
      } else if (url.pathname === "/seller/authorized") {
        update("connecting");
        await typedInvoke(complete, { raw });
        update("completed");
      } else {
        throw new Error();
      }
    } catch {
      update(phase === "cancelling" ? null : "failed");
    } finally {
      busy = false;
      if (phase === "cancelling") update(null);
      const next = queued;
      queued = undefined;
      if (next) handleSellerLink(next, new URL(next));
    }
  })().catch(() => {
    // Report unexpected UI failures without exposing authorization data.
    console.error("Market connection UI update failed");
  });
  return true;
}
