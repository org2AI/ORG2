import {
  MOBILE_CONNECT_TICKET_PATH,
  MOBILE_WS_PATH,
  type MobileConnectTicketRequest,
  type MobileConnectTicketResponse,
} from "@src/contracts/mobile-relay/v1/relay";

import { buildMobileWsUrl } from "../../connection/buildMobileWsUrl";
import { MobileConnectionAuthorizationError } from "../../connection/types";
import type {
  MobileRemoteConnectionPort,
  MobileRemoteRuntimePort,
} from "../types";

async function readTicket(
  response: Response
): Promise<Partial<MobileConnectTicketResponse>> {
  if (!response.body) throw new Error("Invalid Relay connection ticket");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (
      let result = await reader.read();
      !result.done;
      result = await reader.read()
    ) {
      const { value } = result;
      size += value.byteLength;
      if (size > 4096) throw new Error("Invalid Relay connection ticket");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === "object" && !Array.isArray(value))
      return value;
  } catch {
    /* Do not echo a server-controlled payload in parse errors. */
  }
  throw new Error("Invalid Relay connection ticket");
}

/** Only build-configured Relays may receive a Cloud Bearer. Never trust a QR
 * supplied host with the user's account token, and never follow redirects. */
export function createNativeSocketPreparation(options: {
  trustedRelayUrls: string[];
  fetcher: typeof fetch;
  runtime: Pick<MobileRemoteRuntimePort, "now" | "setTimeout" | "clearTimeout">;
}): MobileRemoteConnectionPort["prepareSocketUrl"] {
  const trusted = new Set(
    options.trustedRelayUrls.map((value) => {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    })
  );
  return async (config, context) => {
    const ws = new URL(buildMobileWsUrl(config));
    // LAN has its own device-credential handshake; no Cloud token leaves here.
    if (ws.pathname === "/mobile/ws") return ws.toString();
    if (
      ws.pathname !== MOBILE_WS_PATH ||
      ws.username ||
      ws.password ||
      !trusted.has(`${ws.origin}${ws.pathname}`)
    ) {
      throw new Error("This Relay is not a trusted account endpoint");
    }
    if (!config.desktopId || !config.deviceToken)
      throw new Error("Scan a new desktop pairing code");
    context.signal.throwIfAborted();
    const session = await context.getSession();
    context.signal.throwIfAborted();
    if (
      session.userId !== context.authUserId ||
      session.expiresAt * 1000 <= options.runtime.now()
    )
      throw new Error("Account session expired or changed");
    const http = new URL(ws);
    http.protocol = ws.protocol === "wss:" ? "https:" : "http:";
    http.pathname = MOBILE_CONNECT_TICKET_PATH;
    http.search = "";
    http.hash = "";
    const body: MobileConnectTicketRequest = {
      desktopId: config.desktopId,
      deviceToken: config.deviceToken,
      pairingCode: config.pairingCode ?? "",
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener("abort", abort, { once: true });
    const timer = options.runtime.setTimeout(abort, 10_000);
    try {
      const response = await options.fetcher(http, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      context.signal.throwIfAborted();
      if (!response.ok) {
        await response.body?.cancel();
        // Do not echo server-controlled text, credentials or request URLs.
        const message = `Relay connection authorization failed (${response.status})`;
        if (response.status === 401 || response.status === 403)
          throw new MobileConnectionAuthorizationError(message);
        throw new Error(message);
      }
      const grant = await readTicket(response);
      context.signal.throwIfAborted();
      if (
        typeof grant.ticket !== "string" ||
        !/^[a-f0-9]{64}$/.test(grant.ticket) ||
        !Number.isSafeInteger(grant.expiresAtMs) ||
        grant.expiresAtMs! <= options.runtime.now() ||
        !Number.isSafeInteger(grant.authExpiresAtMs) ||
        grant.authExpiresAtMs! > session.expiresAt * 1000 ||
        grant.expiresAtMs! > grant.authExpiresAtMs! ||
        grant.expiresAtMs! > options.runtime.now() + 60_000
      )
        throw new Error("Invalid Relay connection ticket");
      ws.search = "";
      ws.hash = "";
      ws.searchParams.set("ticket", grant.ticket);
      return ws.toString();
    } finally {
      options.runtime.clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    }
  };
}
