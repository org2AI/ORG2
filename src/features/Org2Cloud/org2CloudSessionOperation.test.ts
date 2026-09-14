import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY,
  getOfficialCloudEndpoint,
} from "./config";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
} from "./org2CloudAuthAtom";
import { org2CloudEndpointOverrideAtom } from "./org2CloudEndpointAtom";
import {
  resetOrgEndpointDirectory,
  setAnonKeyDirectory,
  setOrgEndpointDirectory,
} from "./org2CloudOrgEndpointRouter";
import { createCloudSessionOperation } from "./org2CloudSessionOperation";

const endpoint = getOfficialCloudEndpoint();
const auth: Org2CloudAuthState = {
  kind: "org2_cloud",
  supabaseUrl: endpoint.supabaseUrl,
  supabaseAnonKey: endpoint.anonKey,
  userId: "operation-user",
  accessToken: "operation-token",
  refreshToken: "operation-refresh",
  expiresAt: 4_000_000_000,
  profile: { displayName: "Operation test" },
};

afterEach(() => {
  resetOrgEndpointDirectory();
  localStorage.removeItem(ORG2_CLOUD_ENDPOINT_OVERRIDE_STORAGE_KEY);
  vi.restoreAllMocks();
});

function fixture() {
  const store = createStore();
  store.set(org2CloudAuthAtom, auth);
  const controller = new AbortController();
  const operation = createCloudSessionOperation(
    store,
    auth,
    "org-a",
    () => true,
    controller
  );
  return {
    store,
    controller,
    operation,
    authSnapshot: store.get(org2CloudAuthAtom),
  };
}

describe("cloud operation endpoint invalidation", () => {
  it("cancels a hung request when only its org route changes", async () => {
    const { store, operation, authSnapshot } = fixture();
    const pending = operation.wait(() => new Promise<never>(() => {}));
    const cancelled = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    try {
      setOrgEndpointDirectory([
        [
          "unrelated",
          { ...endpoint, supabaseUrl: "https://unrelated.example" },
        ],
      ]);
      expect(operation.signal.aborted).toBe(false);
      setOrgEndpointDirectory([
        ["org-a", { ...endpoint, supabaseUrl: "https://replacement.example" }],
      ]);
      expect(store.get(org2CloudAuthAtom)).toBe(authSnapshot);
      expect(operation.signal.aborted).toBe(true);
      await cancelled;
    } finally {
      operation.dispose();
    }
  });

  it("cancels a hung request when the shard key changes without an auth change", async () => {
    const { store, operation, authSnapshot } = fixture();
    const pending = operation.wait(() => new Promise<never>(() => {}));
    const cancelled = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    try {
      setAnonKeyDirectory([[endpoint.supabaseUrl, "replacement-anon-key"]]);
      expect(store.get(org2CloudAuthAtom)).toBe(authSnapshot);
      expect(operation.signal.aborted).toBe(true);
      await cancelled;
    } finally {
      operation.dispose();
    }
  });

  it("cancels at the override atom write before the persisted endpoint changes", async () => {
    const { store, operation, authSnapshot } = fixture();
    const pending = operation.wait(() => new Promise<never>(() => {}));
    const cancelled = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    try {
      store.set(org2CloudEndpointOverrideAtom, {
        supabaseUrl: "https://override.example",
        webOrigin: "https://app.override.example",
        anonKey: "override-key",
      });
      expect(store.get(org2CloudAuthAtom)).toBe(authSnapshot);
      expect(operation.signal.aborted).toBe(true);
      await cancelled;
    } finally {
      operation.dispose();
    }
  });

  it("releases identity, override, and directory subscriptions on dispose", () => {
    const { store, operation, controller } = fixture();
    const abort = vi.spyOn(controller, "abort");
    operation.dispose();
    store.set(org2CloudAuthAtom, { ...auth, userId: "new-user" });
    store.set(org2CloudEndpointOverrideAtom, {
      supabaseUrl: "https://override.example",
      webOrigin: "https://app.override.example",
      anonKey: "override-key",
    });
    setOrgEndpointDirectory([["org-a", { ...endpoint, anonKey: "new-key" }]]);
    expect(abort).not.toHaveBeenCalled();
  });
});
