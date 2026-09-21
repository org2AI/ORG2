import { afterEach, describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "./mobileRpcClient";
import {
  MobileSessionIdentityInvalidated,
  cachedMobileSessionIdentity,
  invalidateMobileSessionIdentities,
  mobileSessionIdentityGeneration,
  prefetchMobileSessionIdentities,
  resolveMobileSessionIdentity,
  subscribeMobileSessionIdentities,
} from "./mobileSessionIdentityCache";

function clientWith(
  call = vi.fn().mockResolvedValue({ sessionId: "owner", managed: true })
) {
  return {
    call,
    close: vi.fn(),
    notify: vi.fn(),
    onNotification: () => () => {},
    readyState: 1,
  } satisfies MobileRpcClient;
}

describe("connection-scoped session identity cache", () => {
  afterEach(() => vi.useRealTimers());

  it("shares pending lookups and retains only validated successes for this client", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const client = clientWith(call);
    const first = resolveMobileSessionIdentity(client, "mirror");
    const second = resolveMobileSessionIdentity(client, "mirror");
    expect(second).toBe(first);
    await Promise.resolve();
    finish({ sessionId: "owner", managed: true });
    await first;
    expect(cachedMobileSessionIdentity(client, "mirror")).toEqual({
      sessionId: "owner",
      managed: true,
    });
    await resolveMobileSessionIdentity(client, "mirror");
    expect(call).toHaveBeenCalledOnce();
    const other = clientWith();
    expect(cachedMobileSessionIdentity(other, "mirror")).toBeUndefined();
    await resolveMobileSessionIdentity(other, "mirror");
    expect(other.call).toHaveBeenCalledOnce();
  });

  it("notifies only current client subscribers and releases listeners on unmount", () => {
    const first = clientWith();
    const second = clientWith();
    const listener = vi.fn();
    const other = vi.fn();
    const unsubscribe = subscribeMobileSessionIdentities(first, listener);
    const unsubscribeOther = subscribeMobileSessionIdentities(second, other);
    invalidateMobileSessionIdentities(first);
    expect(listener).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    expect(mobileSessionIdentityGeneration(first)).toBe(1);
    unsubscribe();
    invalidateMobileSessionIdentities(first);
    expect(listener).toHaveBeenCalledOnce();
    expect(mobileSessionIdentityGeneration(first)).toBe(2);
    expect(mobileSessionIdentityGeneration(second)).toBe(0);
    unsubscribeOther();
  });

  it("does not retain failures or malformed responses", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ sessionId: " ", managed: true })
      .mockResolvedValueOnce({ sessionId: "safe", managed: false });
    const client = clientWith(call);
    await expect(resolveMobileSessionIdentity(client, "s")).rejects.toThrow(
      "unavailable"
    );
    await expect(resolveMobileSessionIdentity(client, "s")).rejects.toThrow(
      "Invalid session identity"
    );
    expect(cachedMobileSessionIdentity(client, "s")).toBeUndefined();
    await expect(resolveMobileSessionIdentity(client, "s")).resolves.toEqual({
      sessionId: "safe",
      managed: false,
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("bounds successful entries and expires them lazily without timers", async () => {
    vi.useFakeTimers();
    const client = clientWith();
    for (let index = 0; index < 33; index++)
      await resolveMobileSessionIdentity(client, String(index));
    expect(cachedMobileSessionIdentity(client, "0")).toBeUndefined();
    expect(cachedMobileSessionIdentity(client, "1")).toBeDefined();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(cachedMobileSessionIdentity(client, "32")).toBeUndefined();
    await resolveMobileSessionIdentity(client, "32");
    expect(client.call).toHaveBeenCalledTimes(34);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels invalidated flights and prevents a late result from repopulating the cache", async () => {
    let finishOld!: (value: unknown) => void;
    const call = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValueOnce({ sessionId: "new-owner", managed: true });
    const client = clientWith(call);
    const old = resolveMobileSessionIdentity(client, "s");
    const rejected = expect(old).rejects.toBeInstanceOf(
      MobileSessionIdentityInvalidated
    );
    await Promise.resolve();
    const signal = call.mock.calls[0][2] as AbortSignal;
    invalidateMobileSessionIdentities(client);
    expect(signal.aborted).toBe(true);
    await resolveMobileSessionIdentity(client, "s");
    finishOld({ sessionId: "old-owner", managed: true });
    await rejected;
    expect(cachedMobileSessionIdentity(client, "s")?.sessionId).toBe(
      "new-owner"
    );
  });

  it("bounds distinct pending lookups and releases capacity when they settle", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const client = clientWith(vi.fn().mockReturnValue(pending));
    const flights = Array.from({ length: 8 }, (_, index) =>
      resolveMobileSessionIdentity(client, String(index))
    );
    await expect(
      resolveMobileSessionIdentity(client, "overflow")
    ).rejects.toThrow("Too many pending");
    finish({ sessionId: "owner", managed: true });
    await Promise.all(flights);
    await expect(
      resolveMobileSessionIdentity(client, "fresh")
    ).resolves.toEqual({ sessionId: "owner", managed: true });
  });

  it("prefetches only Codex mirrors that can resolve to a managed owner", async () => {
    const call = vi.fn().mockImplementation((_method, params) =>
      Promise.resolve({
        sessionId: `owner-for-${String(params?.sessionId)}`,
        managed: true,
      })
    );
    const client = clientWith(call);

    await prefetchMobileSessionIdentities(client, [
      {
        id: "codexapp-external",
        name: "Imported Codex",
        status: "idle",
        sendCapability: "external_codex",
      },
      {
        id: "claudecodeapp-read-only",
        name: "Imported Claude",
        status: "idle",
        sendCapability: "read_only",
      },
      {
        id: "codexapp-already-managed",
        name: "Managed Codex",
        status: "idle",
        sendCapability: "native",
      },
      {
        id: "cliagent-native",
        name: "Native",
        status: "idle",
        sendCapability: "native",
      },
    ]);

    expect(call.mock.calls.map(([, params]) => params?.sessionId)).toEqual([
      "codexapp-external",
      "codexapp-already-managed",
    ]);
    expect(cachedMobileSessionIdentity(client, "codexapp-external")).toEqual({
      sessionId: "owner-for-codexapp-external",
      managed: true,
    });
    expect(
      cachedMobileSessionIdentity(client, "codexapp-already-managed")
    ).toBeDefined();
    expect(
      cachedMobileSessionIdentity(client, "claudecodeapp-read-only")
    ).toBeUndefined();
    expect(
      cachedMobileSessionIdentity(client, "cliagent-native")
    ).toBeUndefined();
  });

  it("does not let one failed prefetch reject the roster and retries it on demand", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("desktop busy"))
      .mockResolvedValueOnce({ sessionId: "owner", managed: true });
    const client = clientWith(call);
    const rows = [
      {
        id: "codexapp-retry",
        name: "Imported Codex",
        status: "idle" as const,
        sendCapability: "external_codex" as const,
      },
    ];

    await expect(
      prefetchMobileSessionIdentities(client, rows)
    ).resolves.toBeUndefined();
    expect(
      cachedMobileSessionIdentity(client, "codexapp-retry")
    ).toBeUndefined();
    await expect(
      resolveMobileSessionIdentity(client, "codexapp-retry")
    ).resolves.toEqual({ sessionId: "owner", managed: true });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight prefetch with a user opening the same row", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const client = clientWith(call);
    const rows = [
      {
        id: "codexapp-clicked",
        name: "Imported Codex",
        status: "idle" as const,
        sendCapability: "external_codex" as const,
      },
    ];

    const prefetch = prefetchMobileSessionIdentities(client, rows);
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    const opening = resolveMobileSessionIdentity(client, "codexapp-clicked");
    expect(call).toHaveBeenCalledOnce();
    finish({ sessionId: "owner", managed: true });
    await expect(opening).resolves.toEqual({
      sessionId: "owner",
      managed: true,
    });
    await prefetch;
    expect(call).toHaveBeenCalledOnce();
  });

  it("isolates clients and rewarms invalidated identities on the next roster", async () => {
    const first = clientWith(
      vi.fn().mockResolvedValue({ sessionId: "first-owner", managed: true })
    );
    const second = clientWith(
      vi.fn().mockResolvedValue({ sessionId: "second-owner", managed: true })
    );
    const rows = [
      {
        id: "codexapp-shared-name",
        name: "Imported Codex",
        status: "idle" as const,
        sendCapability: "external_codex" as const,
      },
    ];

    await prefetchMobileSessionIdentities(first, rows);
    expect(
      cachedMobileSessionIdentity(second, "codexapp-shared-name")
    ).toBeUndefined();
    await prefetchMobileSessionIdentities(second, rows);
    expect(
      cachedMobileSessionIdentity(second, "codexapp-shared-name")?.sessionId
    ).toBe("second-owner");

    invalidateMobileSessionIdentities(first);
    expect(
      cachedMobileSessionIdentity(first, "codexapp-shared-name")
    ).toBeUndefined();
    await prefetchMobileSessionIdentities(first, rows);
    expect(first.call).toHaveBeenCalledTimes(2);
    await resolveMobileSessionIdentity(first, "codexapp-shared-name");
    expect(first.call).toHaveBeenCalledTimes(2);
  });

  it("starts at most one proactive batch for repeated roster refreshes", async () => {
    let finishes: Array<(value: unknown) => void> = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        })
    );
    const client = clientWith(call);
    const rows = [0, 1].map((index) => ({
      id: `codexapp-refresh-${index}`,
      name: `Imported ${index}`,
      status: "idle" as const,
      sendCapability: "external_codex" as const,
    }));

    const attempts = Array.from({ length: 20 }, () =>
      prefetchMobileSessionIdentities(client, rows)
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call).toHaveBeenCalledTimes(2);

    const current = finishes;
    finishes = [];
    current.forEach((finish) => finish({ sessionId: "owner", managed: true }));
    await Promise.all(attempts);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not start prefetch work after its connection scope is stale", async () => {
    const client = clientWith();
    await prefetchMobileSessionIdentities(
      client,
      [
        {
          id: "codexapp-stale",
          name: "Imported Codex",
          status: "idle",
          sendCapability: "external_codex",
        },
      ],
      () => false
    );
    expect(client.call).not.toHaveBeenCalled();
  });

  it("stops taking queued prefetch rows when its connection becomes stale", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const call = vi.fn().mockReturnValue(pending);
    const client = clientWith(call);
    let current = true;
    const rows = Array.from({ length: 4 }, (_, index) => ({
      id: `codexapp-${index}`,
      name: `Imported ${index}`,
      status: "idle" as const,
      sendCapability: "external_codex" as const,
    }));

    const prefetch = prefetchMobileSessionIdentities(
      client,
      rows,
      () => current
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    current = false;
    finish({ sessionId: "owner", managed: true });
    await prefetch;
    expect(call).toHaveBeenCalledTimes(2);
    expect(cachedMobileSessionIdentity(client, "codexapp-2")).toBeUndefined();
  });

  it("rewarm expires lazily on a roster refresh with no idle timers", async () => {
    vi.useFakeTimers();
    const client = clientWith();
    const rows = [
      { id: "codexapp-expiring", name: "Codex", status: "idle" as const },
    ];
    await prefetchMobileSessionIdentities(client, rows);
    await prefetchMobileSessionIdentities(client, rows);
    expect(client.call).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await prefetchMobileSessionIdentities(client, rows);
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds repeated invalidation traffic and resumes only on a later roster event", async () => {
    vi.useFakeTimers();
    const client = clientWith();
    const rows = [
      { id: "codexapp-churn", name: "Codex", status: "idle" as const },
    ];
    for (let i = 0; i < 40; i++) {
      invalidateMobileSessionIdentities(client);
      await prefetchMobileSessionIdentities(client, rows);
    }
    expect(client.call).toHaveBeenCalledTimes(16);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(client.call).toHaveBeenCalledTimes(16);
    expect(vi.getTimerCount()).toBe(0);
    await prefetchMobileSessionIdentities(client, rows);
    expect(client.call).toHaveBeenCalledTimes(17);
  });

  it("coalesces new rosters while a batch runs and skips superseded rows", async () => {
    const releases: Array<() => void> = [];
    const call = vi.fn(
      (_method, params) =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({ sessionId: params.sessionId, managed: false })
          );
        })
    );
    const client = clientWith(call);
    const rows = (names: string[]) =>
      names.map((name) => ({
        id: `codexapp-${name}`,
        name,
        status: "idle" as const,
      }));
    const first = prefetchMobileSessionIdentities(
      client,
      rows(["old1", "old2", "old3"])
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    const replaced = prefetchMobileSessionIdentities(
      client,
      rows(["replaced"])
    );
    const latest = prefetchMobileSessionIdentities(client, rows(["latest"]));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(3));
    expect(call.mock.calls.map(([, params]) => params.sessionId)).toEqual([
      "codexapp-old1",
      "codexapp-old2",
      "codexapp-latest",
    ]);
    releases.splice(0).forEach((release) => release());
    await Promise.all([first, replaced, latest]);
  });

  it("can resume preparation on a visible roster after an interrupted batch", async () => {
    let current = true;
    const call = vi.fn().mockImplementation((_method, params) => {
      current = false;
      return Promise.resolve({ sessionId: params.sessionId, managed: false });
    });
    const client = clientWith(call);
    const rows = [1, 2, 3].map((index) => ({
      id: `codexapp-visible-${index}`,
      name: "Codex",
      status: "idle" as const,
    }));
    await prefetchMobileSessionIdentities(client, rows, () => current);
    expect(call).toHaveBeenCalledTimes(2);
    await prefetchMobileSessionIdentities(client, rows, () => false);
    expect(call).toHaveBeenCalledTimes(2);
    current = true;
    await prefetchMobileSessionIdentities(client, rows, () => current);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("bounds prefetch candidates and concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    let releases: Array<() => void> = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve({ sessionId: "owner", managed: true });
          });
        })
    );
    const client = clientWith(call);
    const prefetch = prefetchMobileSessionIdentities(
      client,
      Array.from({ length: 10 }, (_, index) => ({
        id: `codexapp-bounded-${index}`,
        name: `Imported ${index}`,
        status: "idle" as const,
        sendCapability: "external_codex" as const,
      }))
    );

    for (let batch = 0; batch < 4; batch++) {
      await vi.waitFor(() => expect(active).toBe(2));
      const current = releases;
      releases = [];
      current.forEach((release) => release());
      await Promise.resolve();
      await Promise.resolve();
    }
    await prefetch;
    expect(call).toHaveBeenCalledTimes(8);
    expect(maxActive).toBe(2);
  });
});
