import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";
import { openConfiguredMarketClient } from "./launch";
import { loadMarketExecutionProfilesWithDiagnostics } from "./marketProfiles";
import { loadConnections, prepareSessionSource } from "./rpc";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  ready: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: mocks.invoke,
}));
vi.mock("@src/api/http/auth/sharedAuthStorage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/api/http/auth/sharedAuthStorage")
  >()),
  awaitNativeCloudOwnerReady: mocks.ready,
}));
const connection = {
  identity_user_id: USER_A,
  workspace_id: "ws_account",
  target: "org2" as const,
};
const status = {
  enabled: true,
  app_scheme: "orgii",
  buyer_persistent_credentials: true,
  connections: [{ ...connection, phase: "authorization_saved" }],
};
const entry = {
  workspace_id: "ws_package",
  entitlement_id: "pa_beginner",
  service_id: "package-beginner",
  service_name: "Beginner",
  models: ["claude-sonnet-5"],
  models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
  status: "active",
  expires_at: null,
};
const rotated = () =>
  new Response(
    JSON.stringify({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }),
    { status: 200 }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.ready.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "market_connection_status") return status;
    if (command === "market_connection_options") return [entry];
    if (command === "market_connection_prepare_session")
      return { credential_source: "market:test" };
    throw new Error(`unexpected command ${command}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

it("refreshes expired signed-in auth, persists it and waits for native sync before loading packages", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockResolvedValueOnce(rotated());
  let releaseNative!: () => void;
  mocks.ready.mockImplementationOnce(
    () => new Promise<void>((resolve) => (releaseNative = resolve))
  );
  const request = loadMarketExecutionProfilesWithDiagnostics(store);
  await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce());
  expect(store.get(org2CloudAuthAtom)?.refreshToken).toBe("rotated-refresh");
  expect(mocks.invoke).not.toHaveBeenCalled();
  releaseNative();
  const result = await request;
  expect(result.errors).toEqual([]);
  expect(result.profiles.map((profile) => profile.label)).toEqual(["Beginner"]);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0][0]).toContain(
    "/auth/v1/token?grant_type=refresh_token"
  );
});

it("refreshes before a native session operation even without reopening a picker", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockResolvedValueOnce(rotated());
  await expect(
    prepareSessionSource(
      connection,
      "ws_package",
      "pa_beginner",
      "rust_agent",
      "claude-sonnet-5"
    )
  ).resolves.toEqual({ credential_source: "market:test" });
  expect(store.get(org2CloudAuthAtom)?.accessToken).toBe("rotated-access");
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it("shares concurrent refreshes and does not make a refresh request for valid auth", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockResolvedValueOnce(rotated());
  await expect(
    Promise.all([loadConnections(store), loadConnections(store)])
  ).resolves.toEqual([status, status]);
  await loadConnections(store);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it("surfaces retryable refresh failure instead of returning an empty successful catalog", async () => {
  const store = signedInStore();
  const expired = { ...authFor(), expiresAt: 0 };
  store.set(org2CloudAuthAtom, expired);
  mocks.fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(
    loadMarketExecutionProfilesWithDiagnostics(store)
  ).rejects.toThrow("market_cloud_verification_unavailable");
  expect(store.get(org2CloudAuthAtom)).toEqual(expired);
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("clears permanently rejected auth and never calls a native operation with it", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
  await expect(loadConnections(store)).rejects.toThrow(
    "market_cloud_sign_in_required"
  );
  expect(store.get(org2CloudAuthAtom)).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("does not resurrect an older account when a refresh finishes after account switching", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  let finish!: (response: Response) => void;
  mocks.fetch.mockImplementationOnce(
    () => new Promise<Response>((resolve) => (finish = resolve))
  );
  const request = loadConnections(store);
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  const newer = authFor(USER_B);
  store.set(org2CloudAuthAtom, newer);
  finish(rotated());
  await expect(request).rejects.toThrow("market_identity_changed");
  expect(store.get(org2CloudAuthAtom)).toBe(newer);
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("rejects A-to-B-to-A ownership transitions while native persistence is pending", async () => {
  const store = signedInStore();
  const original = store.get(org2CloudAuthAtom);
  let release!: () => void;
  mocks.ready.mockImplementationOnce(
    () => new Promise<void>((resolve) => (release = resolve))
  );
  const request = loadConnections(store);
  await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce());
  store.set(org2CloudAuthAtom, authFor(USER_B));
  store.set(org2CloudAuthAtom, original);
  release();
  await expect(request).rejects.toThrow("market_identity_mismatch");
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("preserves native verification failures as errors rather than an empty catalog", async () => {
  const store = signedInStore();
  mocks.invoke.mockRejectedValueOnce("market_cloud_sign_in_required");
  await expect(
    loadMarketExecutionProfilesWithDiagnostics(store)
  ).rejects.toThrow();
});

it("refreshes before reopening an already configured official app", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockResolvedValueOnce(rotated());
  mocks.invoke.mockResolvedValueOnce(null);
  await openConfiguredMarketClient("codex", "market-app:existing", "gpt-model");
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
    "market_connection_open_client",
    {
      agent: "codex",
      selection: "market-app:existing",
      model: "gpt-model",
    }
  );
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it("makes no refresh or native request for signed-out or custom-Cloud identities", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, null);
  await expect(loadConnections(store)).rejects.toThrow(
    "market_cloud_sign_in_required"
  );
  store.set(org2CloudAuthAtom, {
    ...authFor(),
    supabaseUrl: "https://custom.example",
    expiresAt: 0,
  });
  await expect(loadConnections(store)).rejects.toThrow(
    "market_identity_mismatch"
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("stops before catalog IPC when refreshed auth cannot be persisted or verified natively", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, { ...authFor(), expiresAt: 0 });
  mocks.fetch.mockResolvedValueOnce(rotated());
  mocks.ready.mockRejectedValueOnce(
    new Error("market_cloud_verification_unavailable")
  );
  await expect(
    loadMarketExecutionProfilesWithDiagnostics(store)
  ).rejects.toThrow("market_cloud_verification_unavailable");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
