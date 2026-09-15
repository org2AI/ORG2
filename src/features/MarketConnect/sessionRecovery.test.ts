import { describe, expect, it } from "vitest";

import {
  requiresMarketReauthorization,
  sessionMarketConnection,
} from "./sessionRecovery";

const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_test",
  target: "codex",
};
const encode = (value: unknown) =>
  "market:" +
  btoa(JSON.stringify(value))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
describe("Market session recovery", () => {
  it("reads only valid durable metadata", () => {
    expect(
      sessionMarketConnection(
        encode({ metadata: connection, entitlement_id: "purchase" })
      )
    ).toEqual(connection);
    for (const source of [
      undefined,
      "codex:other",
      "market:invalid",
      "market:" + "a".repeat(1024),
      encode({ metadata: connection }),
      encode({
        metadata: { ...connection, workspace_id: "https://evil.invalid" },
        entitlement_id: "purchase",
      }),
    ]) {
      expect(sessionMarketConnection(source)).toBeNull();
    }
  });
  it("distinguishes native authorization errors from transient provider failures", () => {
    for (const code of [
      "credential_store_read_failed",
      "credential_store_unavailable",
      "market_reauthorization_required",
    ])
      expect(requiresMarketReauthorization(`HTTP 412: ${code}`)).toBe(true);
    for (const code of [
      "HTTP 429",
      "connection_transport_unavailable",
      "grant_expired",
      "not_credential_store_read_failed",
    ])
      expect(requiresMarketReauthorization(code)).toBe(false);
  });
});
