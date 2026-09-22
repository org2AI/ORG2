// @vitest-environment jsdom
import { createStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { captureMarketOwner } from "./identity";
import { USER_A, USER_B, authFor, signedInStore } from "./identity.test-utils";
import {
  loadCachedMarketExecutionProfiles,
  loadMarketExecutionProfilesWithDiagnostics,
} from "./marketProfiles";
import type { Connection, Entry } from "./rpc";

const mocks = vi.hoisted(() => ({
  loadConnections: vi.fn(),
  loadEntries: vi.fn(),
}));
vi.mock("./rpc", () => ({ ...mocks, prepareSessionSource: vi.fn() }));
vi.mock("./usageAuthorization", () => ({ authorizedProfile: vi.fn() }));
const connection = (id: string): Connection & { phase: string } => ({
  identity_user_id: id,
  workspace_id: "ws_anchor",
  target: "org2",
  phase: "authorization_saved",
});
const entry: Entry = {
  workspace_id: "ws_purchase",
  entitlement_id: "pa_one",
  service_id: "pkg_one",
  service_name: "One",
  models: ["gpt"],
  models_by_agent: { codex: ["gpt"], claude: [] },
  status: "active",
  expires_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadConnections.mockResolvedValue({
    connections: [connection(USER_A), connection(USER_B)],
  });
  mocks.loadEntries.mockResolvedValue([entry]);
});
it("filters saved grants by current official owner and does no work signed out", async () => {
  const store = signedInStore();
  const loaded = await loadCachedMarketExecutionProfiles(false, store);
  expect(loaded.profiles.map((p) => p.connection.identity_user_id)).toEqual([
    USER_A,
  ]);
  expect(mocks.loadEntries).toHaveBeenCalledExactlyOnceWith(
    connection(USER_A),
    store
  );
  store.set(org2CloudAuthAtom, null);
  expect(
    (await loadCachedMarketExecutionProfiles(false, store)).profiles
  ).toEqual([]);
  expect(mocks.loadConnections).toHaveBeenCalledTimes(1);
});
it("preserves same-owner refreshed cache and separates stores", async () => {
  const store = signedInStore();
  const first = await loadCachedMarketExecutionProfiles(false, store);
  const scope = captureMarketOwner(USER_A, store);
  store.set(org2CloudAuthAtom, { ...authFor(), accessToken: "refreshed" });
  expect(await loadCachedMarketExecutionProfiles(false, store)).toBe(first);
  scope.assertCurrent();
  scope.dispose();
  const other = createStore();
  other.set(org2CloudAuthAtom, authFor(USER_B));
  expect(
    (await loadCachedMarketExecutionProfiles(false, other)).profiles[0]
      ?.connection.identity_user_id
  ).toBe(USER_B);
  expect(mocks.loadConnections).toHaveBeenCalledTimes(2);
});
it("drops an old A completion even across A to B to A and reloads on demand", async () => {
  const store = signedInStore();
  let finish!: (value: Entry[]) => void;
  mocks.loadEntries.mockImplementationOnce(
    () =>
      new Promise<Entry[]>((resolve) => {
        finish = resolve;
      })
  );
  const loading = loadCachedMarketExecutionProfiles(false, store);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  store.set(org2CloudAuthAtom, authFor(USER_B));
  store.set(org2CloudAuthAtom, authFor(USER_A));
  finish([entry]);
  expect((await loading).profiles).toEqual([]);
  expect(
    (await loadCachedMarketExecutionProfiles(false, store)).profiles
  ).toHaveLength(1);
  expect(mocks.loadConnections).toHaveBeenCalledTimes(2);
});
it("direct loader and operation guards also reject a departed identity", async () => {
  const store = signedInStore();
  let finish!: (value: { connections: Connection[] }) => void;
  mocks.loadConnections.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const scope = captureMarketOwner(USER_A, store);
  const loading = loadMarketExecutionProfilesWithDiagnostics(store);
  store.set(org2CloudAuthAtom, null);
  store.set(org2CloudAuthAtom, authFor(USER_A));
  finish({ connections: [connection(USER_A)] });
  expect((await loading).profiles).toEqual([]);
  expect(mocks.loadEntries).not.toHaveBeenCalled();
  expect(scope.assertCurrent).toThrow("market_identity_mismatch");
  scope.dispose();
});
it("rejects custom endpoint identity even if its user ID is the same", async () => {
  const store = signedInStore();
  store.set(org2CloudAuthAtom, {
    ...authFor(),
    supabaseUrl: "https://other.supabase.co",
  });
  expect(
    (await loadCachedMarketExecutionProfiles(false, store)).profiles
  ).toEqual([]);
  expect(mocks.loadConnections).not.toHaveBeenCalled();
});
