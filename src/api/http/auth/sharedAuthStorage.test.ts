// @vitest-environment jsdom
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn<() => Promise<number>>(),
  synchronize: vi.fn<(epoch?: number | null) => Promise<null>>(),
  construct: vi.fn(),
  disk: new Map<string, unknown>(),
  init: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
  getIdentifier: vi.fn(async () => "org2ai.org2"),
  appDataDir: vi.fn(async () => "/app-data/org2ai.org2.dev/"),
  reload: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
}));

vi.mock("./nativeCloudOwner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nativeCloudOwner")>()),
  suspendNativeCloudOwner: mocks.suspend,
  synchronizeNativeCloudOwner: mocks.synchronize,
}));

const CLOUD_KEY = "orgii:org2-cloud-v1:auth";
const cloudAuth = (
  userId = "owner-a",
  token = "token",
  url = "https://official.example"
) =>
  JSON.stringify({
    kind: "org2_cloud",
    userId,
    accessToken: token,
    supabaseUrl: url,
  });

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: mocks.getIdentifier }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: mocks.appDataDir,
  resolve: async (...parts: string[]) => path.resolve(...parts),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    constructor(path: string, options: unknown) {
      mocks.construct(path, options);
    }

    init = mocks.init;
    reload = mocks.reload;
    save = mocks.save;

    async get<T>(key: string): Promise<T | undefined> {
      return mocks.disk.get(key) as T | undefined;
    }

    async entries<T>(): Promise<Array<[string, T]>> {
      return Array.from(mocks.disk.entries()) as Array<[string, T]>;
    }

    async set(key: string, value: unknown): Promise<void> {
      mocks.disk.set(key, value);
    }

    async delete(key: string): Promise<boolean> {
      return mocks.disk.delete(key);
    }
  },
}));

describe("shared service auth storage", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mocks.disk.clear();
    mocks.construct.mockClear();
    mocks.init.mockClear();
    mocks.isTauri.mockReset();
    mocks.isTauri.mockReturnValue(true);
    mocks.getIdentifier.mockResolvedValue("org2ai.org2");
    mocks.reload.mockClear();
    mocks.save.mockReset();
    mocks.suspend.mockReset().mockResolvedValue(1);
    mocks.synchronize.mockReset().mockResolvedValue(null);
  });

  it("dev reads and updates the bundled login through the primary auth file", async () => {
    mocks.getIdentifier.mockResolvedValue("org2ai.org2.dev");
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    mocks.disk.set("orgii.supabase.auth", "bundled-session");
    mocks.disk.set("orgii:org2-cloud-v1:auth", "bundled-cloud-session");
    const dev = await import("./sharedAuthStorage");
    await dev.initializeSharedServiceAuthStorage();
    expect(mocks.construct).toHaveBeenCalledWith(
      "/app-data/org2ai.org2/shared-service-auth.json",
      { defaults: {}, autoSave: false }
    );
    expect(localStorage.getItem("orgii.supabase.auth")).toBe("bundled-session");
    expect(localStorage.getItem("orgii:org2-cloud-v1:auth")).toBe(
      "bundled-cloud-session"
    );

    await dev.sharedServiceAuthStorage.setItem(
      "orgii.supabase.auth",
      "refreshed-session"
    );
    vi.resetModules();
    mocks.getIdentifier.mockResolvedValue("org2ai.org2");
    const bundled = await import("./sharedAuthStorage");
    await bundled.initializeSharedServiceAuthStorage();
    expect(localStorage.getItem("orgii.supabase.auth")).toBe(
      "refreshed-session"
    );

    await bundled.sharedServiceAuthStorage.removeItem("orgii.supabase.auth");
    await dev.synchronizeSharedServiceAuthStorage();
    expect(localStorage.getItem("orgii.supabase.auth")).toBeNull();
    expect(mocks.disk.has("orgii.supabase.auth")).toBe(false);
  });

  it("numbered test instances continue to use their own auth store", async () => {
    mocks.getIdentifier.mockResolvedValue("org2ai.org2.instance2");
    const { initializeSharedServiceAuthStorage } =
      await import("./sharedAuthStorage");
    await initializeSharedServiceAuthStorage();
    expect(mocks.construct).toHaveBeenCalledWith("shared-service-auth.json", {
      defaults: {},
      autoSave: false,
    });
  });

  it("retries a failed native path lookup on focus synchronization", async () => {
    mocks.getIdentifier.mockRejectedValueOnce(new Error("IPC not ready"));
    const auth = await import("./sharedAuthStorage");
    await expect(auth.initializeSharedServiceAuthStorage()).rejects.toThrow(
      "IPC not ready"
    );
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    mocks.disk.set("orgii.supabase.auth", "bundled-session");
    await auth.synchronizeSharedServiceAuthStorage();
    expect(localStorage.getItem("orgii.supabase.auth")).toBe("bundled-session");
  });

  it("migrates the first Tauri origin's existing login state", async () => {
    localStorage.setItem("orgii.supabase.auth", "shared-session");
    localStorage.setItem("hosted_access_token", "access-token");
    localStorage.setItem("orgii:auth_skipped", "1");
    localStorage.setItem("orgii:org2-cloud-v1:auth", '{"kind":"org2_cloud"}');

    const {
      __SHARED_AUTH_STORAGE_INTERNALS,
      initializeSharedServiceAuthStorage,
    } = await import("./sharedAuthStorage");

    await initializeSharedServiceAuthStorage();

    expect(mocks.construct).toHaveBeenCalledWith(
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_STORE_PATH,
      { defaults: {}, autoSave: false }
    );
    expect(mocks.disk.get("orgii.supabase.auth")).toBe("shared-session");
    expect(mocks.disk.get("hosted_access_token")).toBe("access-token");
    expect(mocks.disk.get("orgii:auth_skipped")).toBe("1");
    expect(mocks.disk.get("orgii:org2-cloud-v1:auth")).toBe(
      '{"kind":"org2_cloud"}'
    );
    expect(
      mocks.disk.get(__SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_KEY)
    ).toBe(__SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_VERSION);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("leaves an empty first origin unclaimed for later migration", async () => {
    const {
      __SHARED_AUTH_STORAGE_INTERNALS,
      initializeSharedServiceAuthStorage,
    } = await import("./sharedAuthStorage");

    await initializeSharedServiceAuthStorage();

    expect(
      mocks.disk.has(__SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_KEY)
    ).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("keeps the v1 cloud migration open until the bundled origin contributes it", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 1);

    let authStorage = await import("./sharedAuthStorage");
    await authStorage.initializeSharedServiceAuthStorage();

    expect(mocks.disk.get("__orgii_shared_auth_schema")).toBe(1);
    expect(mocks.disk.has("orgii:org2-cloud-v1:auth")).toBe(false);

    vi.resetModules();
    localStorage.setItem("orgii:org2-cloud-v1:auth", '{"kind":"org2_cloud"}');
    authStorage = await import("./sharedAuthStorage");
    await authStorage.initializeSharedServiceAuthStorage();

    expect(mocks.disk.get("orgii:org2-cloud-v1:auth")).toBe(
      '{"kind":"org2_cloud"}'
    );
    expect(mocks.disk.get("__orgii_shared_auth_schema")).toBe(2);
  });

  it("treats an established shared sign-out as authoritative", async () => {
    const { __SHARED_AUTH_STORAGE_INTERNALS } =
      await import("./sharedAuthStorage");
    mocks.disk.set(
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_KEY,
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_VERSION
    );
    localStorage.setItem("orgii.supabase.auth", "stale-session");
    localStorage.setItem("hosted_access_token", "stale-token");
    localStorage.setItem("hosted_refresh_token", "stale-refresh-token");

    const { initializeSharedServiceAuthStorage } =
      await import("./sharedAuthStorage");
    await initializeSharedServiceAuthStorage();

    expect(localStorage.getItem("orgii.supabase.auth")).toBeNull();
    expect(localStorage.getItem("hosted_access_token")).toBeNull();
    expect(localStorage.getItem("hosted_refresh_token")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("persists Supabase writes and removals to the shared file", async () => {
    const { __SHARED_AUTH_STORAGE_INTERNALS, sharedServiceAuthStorage } =
      await import("./sharedAuthStorage");
    mocks.disk.set(
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_KEY,
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_VERSION
    );

    await sharedServiceAuthStorage.setItem(
      "orgii.supabase.auth",
      "new-session"
    );
    expect(mocks.disk.get("orgii.supabase.auth")).toBe("new-session");

    await sharedServiceAuthStorage.removeItem("orgii.supabase.auth");
    expect(mocks.disk.has("orgii.supabase.auth")).toBe(false);
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it("coalesces simultaneous focus-return synchronizations", async () => {
    const {
      __SHARED_AUTH_STORAGE_INTERNALS,
      synchronizeSharedServiceAuthStorage,
    } = await import("./sharedAuthStorage");
    mocks.disk.set(
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_KEY,
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_VERSION
    );

    const first = synchronizeSharedServiceAuthStorage();
    const second = synchronizeSharedServiceAuthStorage();

    expect(second).toBe(first);
    await first;
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it("awaitMirroredOrg2CloudAuth persists auth before Rust can read it", async () => {
    const {
      SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY,
      __SHARED_AUTH_STORAGE_INTERNALS,
      awaitMirroredOrg2CloudAuth,
    } = await import("./sharedAuthStorage");
    mocks.disk.set(
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_KEY,
      __SHARED_AUTH_STORAGE_INTERNALS.SHARED_AUTH_SCHEMA_VERSION
    );

    localStorage.setItem(CLOUD_KEY, '{"kind":"org2_cloud","accessToken":"at"}');
    await awaitMirroredOrg2CloudAuth(
      '{"kind":"org2_cloud","accessToken":"at"}'
    );
    expect(mocks.disk.get(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY)).toBe(
      '{"kind":"org2_cloud","accessToken":"at"}'
    );

    localStorage.removeItem(CLOUD_KEY);
    await awaitMirroredOrg2CloudAuth(null);
    expect(mocks.disk.has(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY)).toBe(false);
  });

  it("suspends before saving an account change and resumes only after save", async () => {
    localStorage.setItem(CLOUD_KEY, cloudAuth());
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    const calls: string[] = [];
    let release!: (epoch: number) => void;
    mocks.suspend.mockImplementation(() => {
      calls.push("suspend");
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    mocks.save.mockImplementation(async () => {
      calls.push("save");
    });
    mocks.synchronize.mockImplementation(async (epoch) => {
      expect(epoch).toBe(7);
      expect(mocks.disk.get(CLOUD_KEY)).toBe(cloudAuth("owner-b"));
      calls.push("sync");
      return null;
    });
    const { sharedServiceAuthStorage } = await import("./sharedAuthStorage");
    const pending = sharedServiceAuthStorage.setItem(
      CLOUD_KEY,
      cloudAuth("owner-b")
    );
    expect(calls).toEqual(["suspend"]);
    await Promise.resolve();
    expect(mocks.save).not.toHaveBeenCalled();
    release(7);
    await pending;
    expect(calls).toEqual(["suspend", "save", "sync"]);
  });

  it("keeps the current owner active during token-only refresh", async () => {
    localStorage.setItem(CLOUD_KEY, cloudAuth());
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    const { sharedServiceAuthStorage } = await import("./sharedAuthStorage");
    await sharedServiceAuthStorage.setItem(
      CLOUD_KEY,
      cloudAuth("owner-a", "rotated")
    );
    expect(mocks.suspend).not.toHaveBeenCalled();
    expect(mocks.synchronize).toHaveBeenCalledWith(null);
  });

  it.each([null, cloudAuth("owner-a", "token", "https://other.example")])(
    "suspends on logout or endpoint change (%s)",
    async (value) => {
      localStorage.setItem(CLOUD_KEY, cloudAuth());
      mocks.disk.set("__orgii_shared_auth_schema", 2);
      const { sharedServiceAuthStorage } = await import("./sharedAuthStorage");
      if (value === null) await sharedServiceAuthStorage.removeItem(CLOUD_KEY);
      else await sharedServiceAuthStorage.setItem(CLOUD_KEY, value);
      expect(mocks.suspend).toHaveBeenCalledOnce();
      expect(mocks.synchronize).toHaveBeenCalledWith(1);
    }
  );

  it("does not let A to B to A writes resume a stale native epoch", async () => {
    localStorage.setItem(CLOUD_KEY, cloudAuth());
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    let currentEpoch = 0;
    let activeValue: unknown = null;
    mocks.suspend.mockImplementation(async () => ++currentEpoch);
    mocks.synchronize.mockImplementation(async (epoch) => {
      if (epoch !== currentEpoch) throw new Error("stale epoch");
      activeValue = mocks.disk.get(CLOUD_KEY);
      return null;
    });
    const { sharedServiceAuthStorage } = await import("./sharedAuthStorage");
    const first = sharedServiceAuthStorage.setItem(
      CLOUD_KEY,
      cloudAuth("owner-b")
    );
    const firstResult = expect(first).rejects.toThrow("stale epoch");
    const second = sharedServiceAuthStorage.setItem(CLOUD_KEY, cloudAuth());
    await firstResult;
    await second;
    expect(activeValue).toBe(cloudAuth());
    expect(mocks.synchronize.mock.calls).toEqual([[1], [2]]);
  });

  it.each(["save", "sync"])(
    "recovers explicitly after a failed %s without resuming the old owner",
    async (failure) => {
      localStorage.setItem(CLOUD_KEY, cloudAuth());
      mocks.disk.set("__orgii_shared_auth_schema", 2);
      const { sharedServiceAuthStorage } = await import("./sharedAuthStorage");
      if (failure === "save")
        mocks.save.mockRejectedValueOnce(new Error("unavailable"));
      else mocks.synchronize.mockRejectedValueOnce(new Error("unavailable"));
      await expect(
        sharedServiceAuthStorage.removeItem(CLOUD_KEY)
      ).rejects.toThrow("unavailable");
      if (failure === "save") expect(mocks.synchronize).not.toHaveBeenCalled();
      await sharedServiceAuthStorage.removeItem(CLOUD_KEY);
      expect(mocks.suspend).toHaveBeenCalledTimes(2);
    }
  );

  it("rejects late relay writes after logout before changing disk or native state", async () => {
    const { awaitMirroredOrg2CloudAuth } = await import("./sharedAuthStorage");
    await expect(awaitMirroredOrg2CloudAuth(cloudAuth())).rejects.toThrow(
      "superseded"
    );
    expect(mocks.disk.has(CLOUD_KEY)).toBe(false);
    expect(mocks.suspend).not.toHaveBeenCalled();
    expect(mocks.synchronize).not.toHaveBeenCalled();
  });

  it("rechecks a queued relay write after logout", async () => {
    localStorage.setItem(CLOUD_KEY, cloudAuth());
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    let release!: () => void;
    mocks.reload.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const { sharedServiceAuthStorage, awaitMirroredOrg2CloudAuth } =
      await import("./sharedAuthStorage");
    const blocking = sharedServiceAuthStorage.getItem("orgii.supabase.auth");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const pending = awaitMirroredOrg2CloudAuth(cloudAuth());
    const rejection = expect(pending).rejects.toThrow("superseded");
    localStorage.removeItem(CLOUD_KEY);
    release();
    await blocking;
    await rejection;
    expect(mocks.disk.has(CLOUD_KEY)).toBe(false);
  });

  it("returns ordinary startup hydration while native verification remains pending", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    mocks.disk.set(CLOUD_KEY, cloudAuth());
    let finish!: () => void;
    mocks.synchronize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(null);
        })
    );
    const { initializeSharedServiceAuthStorage, awaitNativeCloudOwnerReady } =
      await import("./sharedAuthStorage");
    await initializeSharedServiceAuthStorage();
    expect(localStorage.getItem(CLOUD_KEY)).toBe(cloudAuth());
    let packageReady = false;
    const ready = awaitNativeCloudOwnerReady().then(() => {
      packageReady = true;
    });
    await Promise.resolve();
    expect(packageReady).toBe(false);
    finish();
    await ready;
    expect(packageReady).toBe(true);
  });

  it("keeps Package readiness rejected when startup handles its background verification failure", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    mocks.disk.set(CLOUD_KEY, cloudAuth());
    let rejectVerification!: (error: Error) => void;
    mocks.synchronize.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectVerification = reject;
        })
    );
    const { initializeSharedServiceAuthStorage, awaitNativeCloudOwnerReady } =
      await import("./sharedAuthStorage");
    await initializeSharedServiceAuthStorage();
    expect(localStorage.getItem(CLOUD_KEY)).toBe(cloudAuth());
    const readinessRejected = expect(
      awaitNativeCloudOwnerReady()
    ).rejects.toThrow("market_cloud_verification_unavailable");
    rejectVerification(new Error("market_cloud_verification_unavailable"));
    await readinessRejected;
  });

  it("persists logout without waiting for an older native verification and follows newest readiness", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    let rejectOld!: (error: Error) => void;
    mocks.synchronize.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        })
    );
    const { sharedServiceAuthStorage, awaitNativeCloudOwnerReady } =
      await import("./sharedAuthStorage");
    const old = sharedServiceAuthStorage.setItem(CLOUD_KEY, cloudAuth());
    const oldRejected = expect(old).rejects.toThrow("stale epoch");
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
    const waitingOnOld = awaitNativeCloudOwnerReady();
    const logout = sharedServiceAuthStorage.removeItem(CLOUD_KEY);
    localStorage.removeItem(CLOUD_KEY);
    await logout;
    expect(mocks.disk.has(CLOUD_KEY)).toBe(false);
    await waitingOnOld;
    await awaitNativeCloudOwnerReady();
    rejectOld(new Error("stale epoch"));
    await oldRejected;
  });

  it("does not suspend the new owner when an older sync fails after its success", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    let rejectOld!: (error: Error) => void;
    mocks.synchronize.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        })
    );
    const { sharedServiceAuthStorage } = await import("./sharedAuthStorage");
    const old = sharedServiceAuthStorage.setItem(CLOUD_KEY, cloudAuth());
    const oldRejected = expect(old).rejects.toThrow("stale epoch");
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
    await sharedServiceAuthStorage.setItem(CLOUD_KEY, cloudAuth("owner-b"));
    rejectOld(new Error("stale epoch"));
    await oldRejected;
    const suspensionCount = mocks.suspend.mock.calls.length;
    await sharedServiceAuthStorage.setItem(
      CLOUD_KEY,
      cloudAuth("owner-b", "new-token")
    );
    expect(mocks.suspend).toHaveBeenCalledTimes(suspensionCount);
  });

  it("retries a failed local logout on focus before accepting the old disk snapshot", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    mocks.disk.set(CLOUD_KEY, cloudAuth());
    localStorage.setItem(CLOUD_KEY, cloudAuth());
    const { sharedServiceAuthStorage, synchronizeSharedServiceAuthStorage } =
      await import("./sharedAuthStorage");
    mocks.reload.mockRejectedValueOnce(new Error("store unavailable"));
    const logout = sharedServiceAuthStorage.removeItem(CLOUD_KEY);
    localStorage.removeItem(CLOUD_KEY);
    await expect(logout).rejects.toThrow("store unavailable");
    expect(mocks.disk.get(CLOUD_KEY)).toBe(cloudAuth());
    await synchronizeSharedServiceAuthStorage();
    expect(mocks.disk.has(CLOUD_KEY)).toBe(false);
    expect(localStorage.getItem(CLOUD_KEY)).toBeNull();
  });

  it("still hydrates and notifies ordinary auth consumers when Market verification is offline", async () => {
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    mocks.disk.set(CLOUD_KEY, cloudAuth());
    mocks.disk.set("orgii.supabase.auth", "ordinary-session");
    mocks.synchronize.mockRejectedValueOnce(
      new Error("market_cloud_verification_unavailable")
    );
    const {
      initializeSharedServiceAuthStorage,
      synchronizeSharedServiceAuthStorage,
      SHARED_AUTH_SYNCHRONIZED_EVENT,
    } = await import("./sharedAuthStorage");
    const notified = vi.fn();
    window.addEventListener(SHARED_AUTH_SYNCHRONIZED_EVENT, notified);
    try {
      await initializeSharedServiceAuthStorage();
      expect(localStorage.getItem(CLOUD_KEY)).toBe(cloudAuth());
      expect(localStorage.getItem("orgii.supabase.auth")).toBe(
        "ordinary-session"
      );
      expect(notified).toHaveBeenCalledOnce();
      await synchronizeSharedServiceAuthStorage();
      expect(mocks.synchronize).toHaveBeenCalledTimes(2);
      expect(notified).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(SHARED_AUTH_SYNCHRONIZED_EVENT, notified);
    }
  });

  it("does not copy an older focus snapshot over a new local logout", async () => {
    localStorage.setItem(CLOUD_KEY, cloudAuth());
    mocks.disk.set(CLOUD_KEY, cloudAuth());
    mocks.disk.set("__orgii_shared_auth_schema", 2);
    let release!: () => void;
    mocks.reload.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const { synchronizeSharedServiceAuthStorage, sharedServiceAuthStorage } =
      await import("./sharedAuthStorage");
    const focus = synchronizeSharedServiceAuthStorage();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const logout = sharedServiceAuthStorage.removeItem(CLOUD_KEY);
    localStorage.removeItem(CLOUD_KEY);
    release();
    await focus;
    await logout;
    expect(localStorage.getItem(CLOUD_KEY)).toBeNull();
    expect(mocks.synchronize.mock.calls).toEqual([[1]]);
  });
});

describe("relay durable publication independent of Market readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mocks.disk.clear();
    mocks.isTauri.mockReturnValue(true);
    mocks.getIdentifier.mockResolvedValue("org2ai.org2");
    mocks.reload.mockReset().mockResolvedValue(undefined);
    mocks.save.mockReset().mockResolvedValue(undefined);
    mocks.suspend.mockReset().mockResolvedValue(1);
    mocks.synchronize.mockReset();
    mocks.disk.set("__orgii_shared_auth_schema", 2);
  });
  it("publishes saved relay credentials while Market verification remains pending", async () => {
    let release!: () => void;
    mocks.synchronize.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          release = () => resolve(null);
        })
    );
    const auth = cloudAuth();
    localStorage.setItem(CLOUD_KEY, auth);
    const { awaitMirroredOrg2CloudAuth, awaitNativeCloudOwnerReady } =
      await import("./sharedAuthStorage");
    const notifyRelay = vi.fn();
    const operation = awaitMirroredOrg2CloudAuth(auth).then(notifyRelay);
    await vi.waitFor(() => expect(mocks.synchronize).toHaveBeenCalled());
    expect(mocks.disk.get(CLOUD_KEY)).toBe(auth);
    expect(mocks.save).toHaveBeenCalled();
    await operation;
    expect(notifyRelay).toHaveBeenCalledOnce();
    const marketReady = vi.fn();
    const market = awaitNativeCloudOwnerReady().then(marketReady);
    await Promise.resolve();
    expect(marketReady).not.toHaveBeenCalled();
    release();
    await market;
    expect(marketReady).toHaveBeenCalledOnce();
  });
  it("publishes saved relay credentials when Market verification fails", async () => {
    mocks.synchronize.mockRejectedValue(
      new Error("market_cloud_verification_unavailable")
    );
    const auth = cloudAuth();
    localStorage.setItem(CLOUD_KEY, auth);
    const { awaitMirroredOrg2CloudAuth } = await import("./sharedAuthStorage");
    const notifyRelay = vi.fn();
    await awaitMirroredOrg2CloudAuth(auth)
      .then(notifyRelay)
      .catch(() => {});
    expect(mocks.disk.get(CLOUD_KEY)).toBe(auth);
    expect(mocks.save).toHaveBeenCalled();
    expect(notifyRelay).toHaveBeenCalledOnce();
  });
});
