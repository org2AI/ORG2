// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

import { RpcError } from "@src/api/tauri/rpc/invoke";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";
import { loadMarketExecutionProfilesWithDiagnostics } from "./marketProfiles";
import { loadConnections } from "./rpc";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  authorize: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));
vi.mock("@src/api/tauri/rpc/invoke", async (original) => ({
  ...(await original<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: mocks.invoke,
}));
vi.mock("./auth", () => ({
  withFreshMarketOwner: (work: () => Promise<unknown>) => work(),
}));
vi.mock("./backgroundAuthorization", () => ({
  authorizeMarketInBackground: mocks.authorize,
}));
const connection = {
  identity_user_id: USER_A,
  workspace_id: "ws_account_owned",
  target: "org2",
  phase: "authorization_saved",
};
const status = {
  enabled: true,
  app_scheme: "orgii",
  buyer_persistent_credentials: true,
  connections: [],
};
let store: ReturnType<typeof signedInStore>;
beforeEach(() => {
  vi.clearAllMocks();
  store = signedInStore();
  store.set(org2CloudAuthAtom, {
    ...authFor(),
    oauthClientId: "11111111-1111-4111-8111-111111111111",
  });
  let saved = false;
  mocks.invoke.mockImplementation(async (procedure: { command: string }) => {
    if (procedure.command === "market_connection_status")
      return { ...status, connections: saved ? [connection] : [] };
    if (procedure.command === "market_connection_begin")
      return "https://market.org2.dev/buyer/connect/authorize?fixture=1";
    if (procedure.command === "market_connection_complete") {
      saved = true;
      return connection;
    }
  });
  mocks.authorize.mockImplementation(
    async (options: {
      complete: (raw: string, current: () => boolean) => Promise<void>;
    }) => options.complete("orgii://market/authorized?fixture=1", () => true)
  );
});
it("discovers an account without receiving any website URL", async () => {
  expect((await loadConnections(store)).connections).toEqual([connection]);
  expect(
    mocks.invoke.mock.calls.find(
      ([p]) => p.command === "market_connection_begin"
    )?.[1]
  ).toEqual({
    raw: "orgii://market/connect?workspace_id=ws_account&target=org2",
  });
  expect(mocks.authorize).toHaveBeenCalledTimes(1);
  await loadConnections(store);
  expect(mocks.authorize).toHaveBeenCalledTimes(1);
});
it("shares concurrent first-load authorization", async () => {
  const results = await Promise.all([
    loadConnections(store),
    loadConnections(store),
  ]);
  expect(results.every((r) => r.connections.length === 1)).toBe(true);
  expect(mocks.authorize).toHaveBeenCalledTimes(1);
});
it("does not enroll a disabled module or unsupported credential store", async () => {
  for (const change of [
    { enabled: false },
    { buyer_persistent_credentials: false },
  ]) {
    mocks.invoke.mockResolvedValueOnce({ ...status, ...change });
    await loadConnections(store);
  }
  expect(mocks.authorize).not.toHaveBeenCalled();
});
it("cancels an enrollment when the account changes after native begin", async () => {
  mocks.invoke.mockImplementation(async (p: { command: string }) => {
    if (p.command === "market_connection_status") return status;
    if (p.command === "market_connection_begin") {
      store.set(org2CloudAuthAtom, {
        ...authFor(USER_B),
        oauthClientId: "11111111-1111-4111-8111-111111111111",
      });
      return "https://market.org2.dev/buyer/connect/authorize";
    }
  });
  await expect(loadConnections(store)).rejects.toThrow(
    "market_identity_mismatch"
  );
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(
    mocks.invoke.mock.calls.some(
      ([p]) => p.command === "market_connection_cancel"
    )
  ).toBe(true);
});
it("failed authorization is retryable without a browser redirect", async () => {
  mocks.authorize.mockRejectedValueOnce(Error("market_request_failed"));
  await expect(loadConnections(store)).rejects.toThrow("market_request_failed");
  expect((await loadConnections(store)).connections).toEqual([connection]);
});

it("reuses an existing owner grant without hiding packages behind reauthorization", async () => {
  const existing = { ...connection, workspace_id: "ws_existing_purchase" };
  mocks.invoke.mockResolvedValueOnce({ ...status, connections: [existing] });
  expect((await loadConnections(store)).connections).toEqual([existing]);
  expect(mocks.authorize).not.toHaveBeenCalled();
});

it("reauthorizes a rejected grant once and binds the catalog to its replacement", async () => {
  const old = { ...connection, workspace_id: "ws_old_purchase" };
  let phase = "old";
  mocks.invoke.mockImplementation(
    async (p: { command: string }, input?: { workspaceId: string }) => {
      if (p.command === "market_connection_status")
        return {
          ...status,
          connections:
            phase === "new"
              ? [{ ...old, phase: "reauthorization_required" }, connection]
              : [
                  {
                    ...old,
                    phase:
                      phase === "rejected"
                        ? "reauthorization_required"
                        : old.phase,
                  },
                ],
        };
      if (p.command === "market_connection_options") {
        if (input?.workspaceId === old.workspace_id) {
          phase = "rejected";
          throw new RpcError(
            p.command,
            "authorization rejected",
            "market_reauthorization_required"
          );
        }
        return [
          {
            workspace_id: "ws_package",
            entitlement_id: "pa_test",
            service_id: "test",
            service_name: "Recovered",
            models: ["model"],
            models_by_agent: { claude: ["model"], codex: [] },
            status: "active",
            expires_at: null,
          },
        ];
      }
      if (p.command === "market_connection_begin")
        return "https://market.org2.dev/buyer/connect/authorize?fixture=1";
      if (p.command === "market_connection_complete") {
        phase = "new";
        return connection;
      }
    }
  );
  const result = await loadMarketExecutionProfilesWithDiagnostics(store);
  expect(result.errors).toEqual([]);
  expect(result.profiles[0]?.connection).toEqual(connection);
  expect(mocks.authorize).toHaveBeenCalledTimes(1);
});

it.each([
  "market_reauthorization_required",
  "market_request_failed",
  "managed_service_unavailable",
])("bounds catalog recovery for %s", async (code) => {
  let saved = true;
  mocks.invoke.mockImplementation(async (p: { command: string }) => {
    if (p.command === "market_connection_status")
      return {
        ...status,
        connections: [
          {
            ...connection,
            phase: saved ? "authorization_saved" : "reauthorization_required",
          },
        ],
      };
    if (p.command === "market_connection_options") {
      if (code === "market_reauthorization_required") saved = false;
      throw new RpcError(p.command, code, code);
    }
    if (p.command === "market_connection_begin")
      return "https://market.org2.dev/buyer/connect/authorize?fixture=1";
    if (p.command === "market_connection_complete") {
      saved = true;
      return connection;
    }
  });
  const result = await loadMarketExecutionProfilesWithDiagnostics(store);
  expect(result.profiles).toEqual([]);
  expect(result.errors).toHaveLength(1);
  expect(mocks.authorize).toHaveBeenCalledTimes(
    code === "market_reauthorization_required" ? 1 : 0
  );
});

it("reuses a concurrent credential replacement after a late authorization rejection", async () => {
  let reads = 0;
  mocks.invoke.mockImplementation(async (p: { command: string }) => {
    if (p.command === "market_connection_status")
      return { ...status, connections: [connection] };
    if (p.command === "market_connection_options") {
      if (reads++ === 0)
        throw new RpcError(
          p.command,
          "rejected",
          "market_reauthorization_required"
        );
      return [];
    }
  });
  expect(await loadMarketExecutionProfilesWithDiagnostics(store)).toEqual({
    profiles: [],
    errors: [],
  });
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(reads).toBe(2);
});

it("does not recover a rejected catalog after the owner changes", async () => {
  mocks.invoke.mockImplementation(async (p: { command: string }) => {
    if (p.command === "market_connection_status")
      return { ...status, connections: [connection] };
    if (p.command === "market_connection_options") {
      store.set(org2CloudAuthAtom, authFor(USER_B));
      throw new RpcError(
        p.command,
        "rejected",
        "market_reauthorization_required"
      );
    }
  });
  expect(await loadMarketExecutionProfilesWithDiagnostics(store)).toEqual({
    profiles: [],
    errors: [],
  });
  expect(mocks.authorize).not.toHaveBeenCalled();
});

it("logs the bounded native failure cause rather than the RPC command", async () => {
  mocks.invoke.mockImplementation(async (p: { command: string }) => {
    if (p.command === "market_connection_status") return status;
    if (p.command === "market_connection_begin")
      return "https://market.org2.dev/buyer/connect/authorize";
    if (p.command === "market_connection_complete")
      throw new RpcError(
        p.command,
        "invalid_connection_grant",
        "invalid_connection_grant"
      );
  });
  await expect(loadConnections(store)).rejects.toThrow(
    "invalid_connection_grant"
  );
  expect(mocks.warn).toHaveBeenCalledWith(
    "Account discovery failed at complete: invalid_connection_grant"
  );
});
it.each([
  "https://example.test/?code=private",
  "invalid_connection_grant https://example.test/?code=private",
  "og2ms.v1.private",
  "market_" + "x".repeat(81),
  { code: "invalid_connection_grant", token: "private" },
])("does not log payloads or unbounded failure text", async (cause) => {
  mocks.authorize.mockRejectedValueOnce(
    new RpcError("market_connection_complete", "sensitive response", cause)
  );
  await expect(loadConnections(store)).rejects.toThrow();
  expect(mocks.warn).toHaveBeenCalledWith(
    "Account discovery failed at authorize: request_failed"
  );
});
