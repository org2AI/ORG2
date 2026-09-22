// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import {
  invalidateMobileSessionIdentities,
  resolveMobileSessionIdentity,
} from "../connection/mobileSessionIdentityCache";
import { useMobileSessionIdentity } from "./useMobileSessionIdentity";

type Identity = ReturnType<typeof useMobileSessionIdentity>;
type Props = {
  client: MobileRpcClient | null;
  requested: string;
  supported: boolean;
  online: boolean;
};

function clientWith(call = vi.fn()) {
  return {
    call,
    close: vi.fn(),
    notify: vi.fn(),
    onNotification: () => () => {},
    readyState: 1,
  } satisfies MobileRpcClient;
}

function deferredIdentity() {
  let resolve!: (value: { sessionId: string; managed: boolean }) => void;
  const promise = new Promise<{ sessionId: string; managed: boolean }>(
    (finish) => {
      resolve = finish;
    }
  );
  return { promise, resolve };
}

describe("useMobileSessionIdentity lifecycle", () => {
  const environment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previousActEnvironment: boolean | undefined;
  let root: Root;
  let latest: Identity;
  let committed: Identity[];
  let props: Props;

  function Harness(value: Props) {
    const identity = useMobileSessionIdentity(
      value.client,
      value.requested,
      value.supported,
      value.online
    );
    useLayoutEffect(() => {
      latest = identity;
      committed.push(identity);
    });
    return null;
  }

  async function render(patch: Partial<Props> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(React.createElement(Harness, props)));
  }

  beforeEach(() => {
    previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement("div"));
    committed = [];
    props = {
      client: clientWith(),
      requested: "codexapp-mirror",
      supported: true,
      online: true,
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it.each([
    ["cliagent-native", true],
    ["claudecodeapp-history", true],
    ["codexapp-legacy-desktop", false],
  ])(
    "opens %s directly without an identity RPC",
    async (requested, supported) => {
      const client = clientWith();
      await render({ client, requested, supported });
      expect(latest).toMatchObject({
        sessionId: requested,
        managed: false,
        error: undefined,
      });
      expect(client.call).not.toHaveBeenCalled();
    }
  );

  it("publishes a warmed owner on the first committed render and preserves a read-only result", async () => {
    const client = clientWith(
      vi
        .fn()
        .mockResolvedValue({ sessionId: "codexapp-mirror", managed: false })
    );
    await resolveMobileSessionIdentity(client, props.requested);
    await render({ client });
    expect(committed[0]).toMatchObject({
      sessionId: "codexapp-mirror",
      managed: false,
      error: undefined,
    });
    expect(client.call).toHaveBeenCalledOnce();
  });

  it("keeps resolved history offline but rechecks the owner before committing a recovered connection", async () => {
    const recovery = deferredIdentity();
    const client = clientWith(
      vi
        .fn()
        .mockResolvedValueOnce({ sessionId: "old-owner", managed: true })
        .mockReturnValueOnce(recovery.promise)
    );
    await render({ client });
    expect(latest.sessionId).toBe("old-owner");
    await render({ online: false });
    expect(latest.sessionId).toBe("old-owner");
    expect(client.call).toHaveBeenCalledOnce();

    await act(async () => invalidateMobileSessionIdentities(client));
    expect(latest.sessionId).toBe("old-owner");
    expect(client.call).toHaveBeenCalledOnce();

    committed = [];
    await render({ online: true });
    expect(committed.every((value) => value.sessionId === undefined)).toBe(
      true
    );
    expect(client.call).toHaveBeenCalledTimes(2);
    await act(async () =>
      recovery.resolve({ sessionId: "new-owner", managed: false })
    );
    expect(latest).toMatchObject({ sessionId: "new-owner", managed: false });
  });

  it("refreshes an expired mirror identity on the next render without background polling", async () => {
    vi.useFakeTimers();
    const fresh = deferredIdentity();
    const client = clientWith(
      vi
        .fn()
        .mockResolvedValueOnce({ sessionId: "codexapp-mirror", managed: false })
        .mockReturnValueOnce(fresh.promise)
    );
    await render({ client });
    expect(latest.sessionId).toBe("codexapp-mirror");
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000 + 1));
    expect(client.call).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    committed = [];
    await render();
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(committed.every((value) => value.sessionId === undefined)).toBe(
      true
    );
    await act(async () =>
      fresh.resolve({ sessionId: "new-owner", managed: true })
    );
    expect(latest).toMatchObject({ sessionId: "new-owner", managed: true });
  });

  it.each(["offline", "canonical"] as const)(
    "preserves the displayed owner after cache expiry when %s",
    async (state) => {
      vi.useFakeTimers();
      const client = clientWith(
        vi
          .fn()
          .mockResolvedValue({ sessionId: "cliagent-owner", managed: true })
      );
      await render({ client });
      await render(
        state === "offline"
          ? { online: false }
          : { requested: "cliagent-owner" }
      );
      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000 + 1));
      await render();
      expect(latest.sessionId).toBe("cliagent-owner");
      expect(client.call).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("clears a failed presence interval and resolves again when the same socket comes online", async () => {
    const recovery = deferredIdentity();
    const client = clientWith(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Desktop offline"))
        .mockReturnValueOnce(recovery.promise)
    );
    await render({ client });
    expect(latest.error).toBe("Desktop offline");
    await render({ online: false });
    expect(latest.error).toBeUndefined();
    await render({ online: true });
    expect(latest.error).toBeUndefined();
    expect(client.call).toHaveBeenCalledTimes(2);
    await act(async () =>
      recovery.resolve({ sessionId: "owner", managed: true })
    );
    expect(latest.sessionId).toBe("owner");
  });

  it("retries a failed lookup only when requested and does not turn a rejection into a background retry loop", async () => {
    const client = clientWith(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("permission denied"))
        .mockResolvedValueOnce({ sessionId: "codexapp-mirror", managed: false })
    );
    await render({ client });
    await render();
    expect(client.call).toHaveBeenCalledOnce();
    expect(latest).toMatchObject({
      sessionId: undefined,
      managed: false,
      error: "permission denied",
    });
    await act(async () => latest.retry());
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({
      sessionId: "codexapp-mirror",
      managed: false,
      error: undefined,
    });
  });

  it("never commits a late owner from the route the user already left", async () => {
    const first = deferredIdentity();
    const second = deferredIdentity();
    const client = clientWith(
      vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
    );
    await render({ client, requested: "codexapp-first" });
    await render({ requested: "codexapp-second" });
    committed = [];
    await act(async () =>
      first.resolve({ sessionId: "first-owner", managed: true })
    );
    expect(latest.sessionId).toBeUndefined();
    expect(committed.some((value) => value.sessionId === "first-owner")).toBe(
      false
    );
    await act(async () =>
      second.resolve({ sessionId: "second-owner", managed: true })
    );
    expect(latest.sessionId).toBe("second-owner");

    await render({ requested: "codexapp-first" });
    expect(latest.sessionId).toBe("first-owner");
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it("isolates the same route after switching authenticated RPC clients", async () => {
    const old = deferredIdentity();
    const oldClient = clientWith(vi.fn().mockReturnValue(old.promise));
    const newClient = clientWith(
      vi.fn().mockResolvedValue({ sessionId: "new-owner", managed: false })
    );
    await render({ client: oldClient });
    await render({ client: newClient });
    await act(async () =>
      old.resolve({ sessionId: "old-owner", managed: true })
    );
    expect(latest).toMatchObject({ sessionId: "new-owner", managed: false });
    expect(oldClient.call).toHaveBeenCalledOnce();
    expect(newClient.call).toHaveBeenCalledOnce();
  });

  it("shares a pending lookup across leaving and reopening the route", async () => {
    const pending = deferredIdentity();
    const client = clientWith(vi.fn().mockReturnValue(pending.promise));
    await render({ client });
    await act(async () => root.render(null));
    await render();
    expect(client.call).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve({ sessionId: "owner", managed: true })
    );
    expect(latest.sessionId).toBe("owner");
  });

  it("retries an invalidated pending lookup without exposing the discarded result or an error", async () => {
    const old = deferredIdentity();
    const fresh = deferredIdentity();
    const client = clientWith(
      vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise)
    );
    await render({ client });
    await act(async () => {
      invalidateMobileSessionIdentities(client);
      old.resolve({ sessionId: "discarded-owner", managed: true });
    });
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ sessionId: undefined, error: undefined });
    expect(
      committed.some((value) => value.sessionId === "discarded-owner")
    ).toBe(false);
    await act(async () =>
      fresh.resolve({ sessionId: "current-owner", managed: false })
    );
    expect(latest).toMatchObject({
      sessionId: "current-owner",
      managed: false,
    });
  });

  it("rechecks an open unresolved mirror when a roster invalidation changes its owner", async () => {
    const fresh = deferredIdentity();
    const client = clientWith(
      vi
        .fn()
        .mockResolvedValueOnce({ sessionId: "codexapp-mirror", managed: false })
        .mockReturnValueOnce(fresh.promise)
    );
    await render({ client });
    expect(latest).toMatchObject({
      sessionId: "codexapp-mirror",
      managed: false,
    });

    // The chat stays mounted while the roster changes. It must not retain a
    // stale mirror or depend on an unrelated parent render to discover its owner.
    committed = [];
    await act(async () => invalidateMobileSessionIdentities(client));
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(latest.sessionId).toBeUndefined();
    expect(committed.every((value) => value.sessionId === undefined)).toBe(
      true
    );
    await act(async () =>
      fresh.resolve({ sessionId: "new-owner", managed: true })
    );
    expect(latest).toMatchObject({ sessionId: "new-owner", managed: true });
  });

  it("keeps an already canonical native route fixed across roster invalidation", async () => {
    const client = clientWith(
      vi.fn().mockResolvedValue({ sessionId: "cliagent-owner", managed: true })
    );
    await render({ client });
    await render({ requested: "cliagent-owner" });
    await act(async () => invalidateMobileSessionIdentities(client));
    expect(latest.sessionId).toBe("cliagent-owner");
    expect(client.call).toHaveBeenCalledOnce();
  });
});
