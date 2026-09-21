// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import { useMobileRelayCloudAuthSync } from "../useMobileRelayCloudAuthSync";

const mocks = vi.hoisted(() => ({
  ensureFreshSession: vi.fn(),
  awaitMirroredOrg2CloudAuth: vi.fn(),
  notifyCloudAuthChanged: vi.fn(),
  listen: vi.fn(),
  settings: new Map<string, unknown>([
    ["mobileRemote.enabled", true],
    ["mobileRemote.relayEnabled", true],
  ]),
}));

vi.mock("@src/features/Org2Cloud/org2CloudClient", () => ({
  ensureFreshSession: mocks.ensureFreshSession,
}));

vi.mock("@src/api/http/auth/sharedAuthStorage", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@src/api/http/auth/sharedAuthStorage")
    >();
  return {
    ...actual,
    awaitMirroredOrg2CloudAuth: mocks.awaitMirroredOrg2CloudAuth,
  };
});

vi.mock("@src/api/tauri/mobileRemote", () => ({
  notifyCloudAuthChanged: mocks.notifyCloudAuthChanged,
}));

vi.mock("@src/hooks/settings/useSettings", () => ({
  useSetting: (key: string) => {
    const value = mocks.settings.get(key);
    return [value, vi.fn()] as const;
  },
}));

vi.mock("@src/hooks/platform/useTauriListen", () => ({
  useTauriListen: mocks.listen,
}));

const AUTH = {
  kind: "org2_cloud" as const,
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "anon",
  userId: "user-1",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: 4_102_444_800,
};

function HookProbe() {
  useMobileRelayCloudAuthSync();
  return null;
}

describe("useMobileRelayCloudAuthSync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.ensureFreshSession.mockReset();
    mocks.awaitMirroredOrg2CloudAuth.mockReset();
    mocks.notifyCloudAuthChanged.mockReset();
    mocks.listen.mockReset();
    mocks.settings.set("mobileRemote.enabled", true);
    mocks.settings.set("mobileRemote.relayEnabled", true);
    mocks.ensureFreshSession.mockImplementation(
      async (auth: typeof AUTH) => auth
    );
    mocks.awaitMirroredOrg2CloudAuth.mockResolvedValue(undefined);
    mocks.notifyCloudAuthChanged.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  it("notifies Rust when cloud auth is missing", async () => {
    const store = createStore();

    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
      await Promise.resolve();
    });

    expect(mocks.awaitMirroredOrg2CloudAuth).toHaveBeenCalledWith(null);
    expect(mocks.notifyCloudAuthChanged).toHaveBeenCalled();
    expect(mocks.ensureFreshSession).not.toHaveBeenCalled();
  });

  it("refreshes auth, mirrors to shared store, then notifies Rust when signed in", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);

    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
      await Promise.resolve();
    });

    expect(mocks.ensureFreshSession).toHaveBeenCalledWith(AUTH, {
      forceRefresh: false,
      onRefreshRejected: expect.any(Function),
    });
    expect(mocks.awaitMirroredOrg2CloudAuth).toHaveBeenCalledWith(
      JSON.stringify(AUTH)
    );
    expect(mocks.notifyCloudAuthChanged).toHaveBeenCalled();
  });

  it("mirrors auth to the shared store before notifying Rust", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);

    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
      await Promise.resolve();
    });

    for (
      let index = 0;
      index < mocks.notifyCloudAuthChanged.mock.calls.length;
      index++
    ) {
      expect(
        mocks.awaitMirroredOrg2CloudAuth.mock.invocationCallOrder[index]
      ).toBeLessThan(
        mocks.notifyCloudAuthChanged.mock.invocationCallOrder[index]
      );
    }
  });

  it("does not mirror a transient refresh failure as sign-out", async () => {
    mocks.ensureFreshSession.mockResolvedValue(null);
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
    });
    expect(mocks.awaitMirroredOrg2CloudAuth).not.toHaveBeenCalled();
    expect(mocks.notifyCloudAuthChanged).not.toHaveBeenCalled();
    expect(store.get(org2CloudAuthAtom)?.userId).toBe(AUTH.userId);
  });

  it.each([null, { ...AUTH, userId: "owner-b", accessToken: "owner-b-token" }])(
    "does not persist a stale refresh after the canonical auth changes to %s",
    async (replacement) => {
      const pending: Array<(auth: typeof AUTH) => void> = [];
      mocks.ensureFreshSession.mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.push(resolve);
          })
      );
      const store = createStore();
      store.set(org2CloudAuthAtom, AUTH);
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(HookProbe)
          )
        );
      });
      expect(pending.length).toBeGreaterThan(0);
      const oldPending = pending.splice(0);
      await act(async () => {
        store.set(org2CloudAuthAtom, replacement);
      });
      mocks.awaitMirroredOrg2CloudAuth.mockClear();
      mocks.notifyCloudAuthChanged.mockClear();
      await act(async () => {
        for (const resolve of oldPending)
          resolve({ ...AUTH, accessToken: "late-old-token" });
      });
      expect(mocks.awaitMirroredOrg2CloudAuth).not.toHaveBeenCalled();
      expect(mocks.notifyCloudAuthChanged).not.toHaveBeenCalled();
      expect(store.get(org2CloudAuthAtom)).toEqual(replacement);
    }
  );

  it("handles a superseded mirror without waking the relay with stale auth", async () => {
    mocks.awaitMirroredOrg2CloudAuth.mockRejectedValue(
      new Error("Cloud auth write was superseded")
    );
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
    });
    expect(mocks.awaitMirroredOrg2CloudAuth).toHaveBeenCalled();
    expect(mocks.notifyCloudAuthChanged).not.toHaveBeenCalled();
  });

  it("does nothing while relay is disabled", async () => {
    mocks.settings.set("mobileRemote.relayEnabled", false);
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);

    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
      await Promise.resolve();
    });

    expect(mocks.ensureFreshSession).not.toHaveBeenCalled();
    expect(mocks.awaitMirroredOrg2CloudAuth).not.toHaveBeenCalled();
    expect(mocks.notifyCloudAuthChanged).not.toHaveBeenCalled();
  });
  it("forces one refresh for concurrent native rejection signals", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
    });
    let resolve!: (value: typeof AUTH) => void;
    mocks.ensureFreshSession.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const signal = mocks.listen.mock.calls.at(-1)![1] as () => void;
    await act(async () => {
      signal();
      signal();
      signal();
    });
    expect(mocks.ensureFreshSession).toHaveBeenLastCalledWith(AUTH, {
      forceRefresh: true,
      onRefreshRejected: expect.any(Function),
    });
    expect(mocks.ensureFreshSession).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve({ ...AUTH, accessToken: "rotated" });
    });
    expect(store.get(org2CloudAuthAtom)?.accessToken).toBe("rotated");
  });

  it("retries a failed durable notification with backoff and cancels on disable", async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      store.set(org2CloudAuthAtom, AUTH);
      mocks.notifyCloudAuthChanged.mockRejectedValueOnce(
        new Error("IPC unavailable")
      );
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(HookProbe)
          )
        );
      });
      expect(mocks.notifyCloudAuthChanged).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mocks.notifyCloudAuthChanged).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      mocks.awaitMirroredOrg2CloudAuth.mockRejectedValue(
        new Error("store unavailable")
      );
      await act(async () => {
        (mocks.listen.mock.calls.at(-1)![1] as () => void)();
      });
      expect(vi.getTimerCount()).toBe(1);
      mocks.settings.set("mobileRemote.enabled", false);
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(HookProbe)
          )
        );
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not notify after logout supersedes an in-flight durable write", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    let finish!: () => void;
    mocks.awaitMirroredOrg2CloudAuth.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        })
    );
    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
    });
    await act(async () => {
      store.set(org2CloudAuthAtom, null);
    });
    mocks.notifyCloudAuthChanged.mockClear();
    await act(async () => {
      finish();
    });
    expect(mocks.notifyCloudAuthChanged).not.toHaveBeenCalled();
  });
  it("does not reconnect for an equivalent hydration, but does for rotated credentials", async () => {
    const store = createStore();
    store.set(org2CloudAuthAtom, AUTH);
    await act(async () => {
      root.render(
        React.createElement(Provider, { store }, React.createElement(HookProbe))
      );
    });
    expect(mocks.notifyCloudAuthChanged).toHaveBeenCalledOnce();
    await act(async () => {
      store.set(org2CloudAuthAtom, { ...AUTH });
    });
    expect(mocks.notifyCloudAuthChanged).toHaveBeenCalledOnce();
    expect(mocks.awaitMirroredOrg2CloudAuth).toHaveBeenCalledOnce();
    await act(async () => {
      store.set(org2CloudAuthAtom, { ...AUTH, accessToken: "replacement" });
    });
    expect(mocks.notifyCloudAuthChanged).toHaveBeenCalledTimes(2);
  });
  it("stops retrying a definitively rejected refresh session and publishes sign-out", async () => {
    vi.useFakeTimers();
    try {
      mocks.ensureFreshSession.mockImplementation(async (_auth, options) => {
        options.onRefreshRejected();
        return null;
      });
      const store = createStore();
      store.set(org2CloudAuthAtom, AUTH);
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(HookProbe)
          )
        );
      });
      expect(store.get(org2CloudAuthAtom)).toBeNull();
      expect(mocks.awaitMirroredOrg2CloudAuth).toHaveBeenCalledWith(null);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mocks.ensureFreshSession).toHaveBeenCalledOnce();
      expect(mocks.notifyCloudAuthChanged).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
