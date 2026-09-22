import { beforeEach, describe, expect, it, vi } from "vitest";

interface MemoryStorage extends Storage {
  failWrites: boolean;
  values: Map<string, string>;
}

function installStorage(initial: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(initial));
  const storage = {
    values,
    failWrites: false,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      if (storage.failWrites) {
        const error = new Error("The quota has been exceeded.");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, String(value));
    },
  } as MemoryStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  return storage;
}

beforeEach(() => {
  installStorage();
  vi.resetModules();
});

async function loadVisitedSessions() {
  const instrumentedStoreModule =
    await import("@src/util/core/state/instrumentedStore");
  const store = instrumentedStoreModule.createInstrumentedStore();
  const visitedModule = await import("../visitedSessionsAtom");
  return { store, ...visitedModule };
}

describe("visited session persistence", () => {
  it("synchronizes the real Desktop atom bidirectionally and reconciles after mobile reconnect", async () => {
    const {
      store,
      markSessionVisited,
      markAllSessionsVisited,
      markAllSessionsVisitedPersisted,
      visitedSessionsAtom,
      visitedSessionIdsAtom,
    } = await loadVisitedSessions();
    const { startDesktopReadStateBridge } =
      await import("../desktopReadStateBridge");
    const { createMobileReadStateSync } =
      await import("@src/modules/MobileRemote/app/mobileReadStateSync");
    type Client =
      import("@src/modules/MobileRemote/connection/mobileRpcClient").MobileRpcClient;
    type Handler =
      import("@src/modules/MobileRemote/connection/mobileRpcClient").RpcNotificationHandler;
    let receive!: (payload: unknown) => void;
    let sequence = 0;
    const waiting = new Map<string, (reply: unknown) => void>();
    const notifications = new Set<Handler>();
    const notifyChanged = vi.fn(async () => {
      notifications.forEach((fn) => fn("session/read_state_changed", {}));
    });
    const stop = startDesktopReadStateBridge({
      listen: async (handler) => {
        receive = handler;
        return () => undefined;
      },
      reply: async (id, visitedIds) => {
        waiting.get(id)?.({ visitedIds });
        waiting.delete(id);
      },
      notifyChanged,
      read: () => store.get(visitedSessionsAtom),
      mark: markAllSessionsVisitedPersisted,
      subscribe: (fn) => store.sub(visitedSessionsAtom, fn),
      onError: (error) => {
        throw error;
      },
    });
    const client: Client = {
      call: <T>(method: string, params?: Record<string, unknown>) =>
        new Promise<T>((resolve) => {
          const requestId = String(++sequence);
          waiting.set(requestId, (reply) => resolve(reply as T));
          receive({
            requestId,
            sessionIds: params?.sessionIds,
            markVisited: method === "session/mark_visited",
            expiresAtMs: Date.now() + 5000,
          });
        }),
      onNotification: (fn) => {
        notifications.add(fn);
        return () => {
          notifications.delete(fn);
        };
      },
      notify: () => undefined,
      close: () => undefined,
      readyState: 1,
    };
    const flush = async () => {
      for (let i = 0; i < 80; i++) await Promise.resolve();
    };
    const mobile = createMobileReadStateSync();
    mobile.watch(["desktop-read", "mobile-read", "while-offline"]);
    mobile.connect(client, "account/desktop");
    await flush();
    expect(mobile.getSnapshot().get("desktop-read")).toBe(false);
    markSessionVisited("desktop-read");
    await flush();
    expect(mobile.getSnapshot().get("desktop-read")).toBe(true);
    mobile.markVisited("mobile-read");
    await flush();
    expect(store.get(visitedSessionsAtom).has("mobile-read")).toBe(true);
    expect(
      JSON.parse(localStorage.getItem("orgii:visited-sessions")!)
    ).toContain("mobile-read");
    expect(mobile.getSnapshot().get("mobile-read")).toBe(true);
    mobile.connect(null, "account/desktop");
    markSessionVisited("while-offline");
    await flush();
    mobile.connect(client, "account/desktop");
    await flush();
    expect(mobile.getSnapshot().get("while-offline")).toBe(true);
    const before = notifyChanged.mock.calls.length;
    markAllSessionsVisited(["batch-a", "batch-a", "batch-b"]);
    await flush();
    expect(notifyChanged.mock.calls.length - before).toBe(1);
    const ids = store.get(visitedSessionIdsAtom);
    markAllSessionsVisited(["batch-a", "batch-b"]);
    await flush();
    expect(store.get(visitedSessionIdsAtom)).toBe(ids);
    expect(notifyChanged.mock.calls.length - before).toBe(1);
    mobile.dispose();
    stop();
    expect(notifications.size).toBe(0);
    expect(waiting.size).toBe(0);
  });
  it("keeps navigation state in memory when persistence exceeds quota", async () => {
    const storage = installStorage({
      "orgii:org2-cloud-v1:auth": "protected-auth",
    });
    storage.failWrites = true;
    const { store, markSessionVisited, visitedSessionIdsAtom } =
      await loadVisitedSessions();

    expect(() => markSessionVisited("session-1")).not.toThrow();
    expect(store.get(visitedSessionIdsAtom)).toEqual(["session-1"]);
    expect(storage.getItem("orgii:org2-cloud-v1:auth")).toBe("protected-auth");
  });
  it("does not acknowledge a remote mark until persistence succeeds, including retry after quota recovery", async () => {
    const storage = installStorage();
    storage.failWrites = true;
    const { markAllSessionsVisitedPersisted } = await loadVisitedSessions();
    expect(() => markAllSessionsVisitedPersisted(["remote"])).toThrow(
      "Could not persist"
    );
    storage.failWrites = false;
    expect(() => markAllSessionsVisitedPersisted(["remote"])).not.toThrow();
    expect(JSON.parse(storage.getItem("orgii:visited-sessions")!)).toContain(
      "remote"
    );
  });

  it("marks a full unread batch in one persisted update while retaining existing read state", async () => {
    const storage = installStorage({
      "orgii:visited-sessions": JSON.stringify(["already-read"]),
    });
    const { store, markAllSessionsVisited, visitedSessionsAtom } =
      await loadVisitedSessions();
    const changed = vi.fn();
    const stop = store.sub(visitedSessionsAtom, changed);
    // Ignore the storage hydration notification produced by mounting.
    changed.mockClear();
    const ids = Array.from({ length: 8 }, (_, i) => `unread-${i}`);
    try {
      markAllSessionsVisited(ids);
      expect(changed).toHaveBeenCalledOnce();
      expect(store.get(visitedSessionsAtom)).toEqual(
        new Set([...ids, "already-read"])
      );
      expect(JSON.parse(storage.getItem("orgii:visited-sessions")!)).toEqual([
        ...ids,
        "already-read",
      ]);
    } finally {
      stop();
    }
  });

  it("bounds and deduplicates an oversized hydrated list", async () => {
    const sessionIds = Array.from(
      { length: 5_100 },
      (_, index) => `session-${index}`
    );
    sessionIds.splice(10, 0, "session-0");
    const storage = installStorage({
      "orgii:visited-sessions": JSON.stringify(sessionIds),
    });
    const { store, visitedSessionIdsAtom, __VISITED_SESSIONS_INTERNALS } =
      await loadVisitedSessions();

    const hydrated = store.get(visitedSessionIdsAtom);
    expect(hydrated).toHaveLength(__VISITED_SESSIONS_INTERNALS.MAX_VISITED_IDS);
    expect(new Set(hydrated).size).toBe(hydrated.length);
    expect(storage.getItem("orgii:visited-sessions")).not.toBeNull();
  });
});
