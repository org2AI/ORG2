import { openUrl } from "@tauri-apps/plugin-opener";
import { z } from "zod/v4";

import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";
import Message from "@src/components/Message";
import i18n from "@src/i18n";

import { handleSellerLink } from "./sellerLink";

const rawInput = z.object({ raw: z.string().max(2048) });
const begin = defineProcedure("market_connection_begin")
  .input(rawInput)
  .output(z.string().url())
  .build();
const complete = defineProcedure("market_connection_complete")
  .input(rawInput)
  .output(
    z.object({
      identity_user_id: z.string().uuid(),
      workspace_id: z.string().regex(/^ws_[A-Za-z0-9_-]{1,120}$/),
      target: z.enum(["claude-code", "claude-app", "codex", "org2"]),
      phase: z.literal("authorization_saved"),
    })
  )
  .build();
const cancel = defineProcedure("market_connection_cancel").build();

// The existing main-window deep-link owner dispatches both warm and cold links.
// Keep at most one operation; never put authorization URLs in logs or dedup sets.
let busy = false;
let queuedCallback: string | undefined;
export function handleMarketConnectionUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "orgii:" || url.hostname !== "market") return false;
  if (handleSellerLink(raw, url)) return true;
  if (busy) {
    if (raw.length <= 2048 && url.pathname === "/authorized")
      queuedCallback ??= raw;
    return true;
  }
  busy = true;
  (async () => {
    try {
      if (url.pathname === "/connect") {
        const authorization = new URL(await typedInvoke(begin, { raw }));
        try {
          if (
            authorization.origin !== "https://market.org2.dev" ||
            authorization.pathname !== "/buyer/connect/authorize" ||
            authorization.username ||
            authorization.password ||
            authorization.hash
          ) {
            throw new Error("invalid_authorization_destination");
          }
          await openUrl(authorization.toString());
        } catch {
          await typedInvoke(cancel);
          throw new Error("browser_open_failed");
        }
      } else if (url.pathname === "/authorized") {
        const result = await typedInvoke(complete, { raw });
        window.dispatchEvent(
          new CustomEvent("market-authorization-saved", { detail: result })
        );
        Message.success(
          i18n.t("integrations:marketConnection.authorizationSaved")
        );
      } else {
        throw new Error("invalid_market_connection_link");
      }
    } catch (error) {
      // Inspect only the known capability code; never display callback/IPC data.
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "";
      Message.error(
        i18n.t(
          message.includes("market_buyer_credential_store_unavailable")
            ? "integrations:marketConnection.platformUnavailable"
            : "integrations:marketConnection.failed"
        )
      );
    } finally {
      busy = false;
      const next = queuedCallback;
      queuedCallback = undefined;
      if (next) handleMarketConnectionUrl(next);
    }
  })().catch(() => {
    // Report unexpected UI failures without exposing authorization data.
    console.error("Market connection UI update failed");
  });
  return true;
}
