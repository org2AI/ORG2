// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../../connection/mobileRpcClient";
import {
  type ChangeScope,
  type Review,
  useChangeReview,
} from "./useChangeReview";

vi.mock("../../platform", async () => {
  const { createBrowserMobileRemotePlatform } =
    await import("../../platform/browser");
  const platform = createBrowserMobileRemotePlatform();
  return { useMobileRemotePlatform: () => platform };
});

interface Props {
  client: MobileRpcClient | null;
  sessionId: string;
  roundId: string | null;
  scope: ChangeScope;
  enabled: boolean;
  revision: string;
  filePath?: string;
}

const review = (path?: string): Review => ({
  complete: true,
  files: path
    ? [
        {
          path,
          additions: 1,
          deletions: 0,
          patches: [],
          before: null,
          after: null,
          availability: "patch_only",
        },
      ]
    : [],
});
const deferred = () => {
  let resolve!: (value: Review) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Review>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let current: ReturnType<typeof useChangeReview>;
let props: Props;
const call = vi.fn();

function Probe(value: Props) {
  const result = useChangeReview(
    value.client,
    value.sessionId,
    value.roundId,
    value.scope,
    value.enabled,
    value.revision,
    value.filePath
  );
  React.useLayoutEffect(() => {
    current = result;
  }, [result]);
  return React.createElement(
    "output",
    null,
    result.error ? "error" : result.value ? "success" : "pending"
  );
}

async function render(next: Partial<Props> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(React.createElement(Probe, props)));
}
async function advance(ms = 250) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  call.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    client: { call } as unknown as MobileRpcClient,
    sessionId: "session-a",
    roundId: "round-one",
    scope: "turn",
    enabled: true,
    revision: "revision-one",
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("useChangeReview", () => {
  it.each(["file.ts", undefined])(
    "moves failed retry immediately to pending and resolves %s without duplicate calls",
    async (path) => {
      const retry = deferred();
      call
        .mockRejectedValueOnce(new Error("offline"))
        .mockReturnValueOnce(retry.promise);
      await render();
      expect(host.textContent).toBe("pending");
      await advance(249);
      expect(call).not.toHaveBeenCalled();
      await advance(1);
      expect(host.textContent).toBe("error");

      await act(async () => {
        for (let index = 0; index < 5; index++) current.retry();
      });
      expect(host.textContent).toBe("pending");
      expect(current.error).toBeUndefined();
      expect(current.value).toBeUndefined();
      expect(vi.getTimerCount()).toBe(1);
      expect(call).toHaveBeenCalledTimes(1);

      await advance();
      expect(call).toHaveBeenCalledTimes(2);
      const signal = call.mock.calls[1][2] as AbortSignal;
      await act(async () => {
        current.retry();
        current.retry();
      });
      await advance(1000);
      expect(call).toHaveBeenCalledTimes(2);
      expect(signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      await act(async () => retry.resolve(review(path)));
      expect(host.textContent).toBe("success");
      expect(current.value).toEqual(review(path));
      expect(current.error).toBeUndefined();
      await act(async () => current.retry());
      await advance(1000);
      expect(call).toHaveBeenCalledTimes(2);
    }
  );

  it.each<Partial<Props>>([
    { sessionId: "session-b" },
    { roundId: "round-two" },
    { scope: "workspace" },
    { revision: "revision-two" },
    { filePath: "other.ts" },
  ])(
    "aborts and isolates a pending response on scope change %j",
    async (next) => {
      const previous = deferred();
      const fresh = deferred();
      call
        .mockReturnValueOnce(previous.promise)
        .mockReturnValueOnce(fresh.promise);
      await render();
      await advance();
      const previousSignal = call.mock.calls[0][2] as AbortSignal;
      await render(next);
      expect(previousSignal.aborted).toBe(true);
      expect(current.value).toBeUndefined();
      await advance();
      await act(async () => fresh.resolve(review("fresh.ts")));
      await act(async () => previous.resolve(review("stale.ts")));
      expect(current.value).toEqual(review("fresh.ts"));
      expect(current.error).toBeUndefined();
      expect(call).toHaveBeenCalledTimes(2);
    }
  );

  it("does not expose the previous client's result or late failure", async () => {
    const previous = deferred();
    const freshCall = vi.fn().mockResolvedValue(review("fresh.ts"));
    call.mockReturnValue(previous.promise);
    await render();
    await advance();
    await render({ client: { call: freshCall } as unknown as MobileRpcClient });
    expect((call.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
    expect(current.value).toBeUndefined();
    await advance();
    await act(async () => previous.reject(new Error("old connection failed")));
    expect(current.value).toEqual(review("fresh.ts"));
    expect(current.error).toBeUndefined();
    expect(freshCall).toHaveBeenCalledTimes(1);
  });

  it("coalesces revision bursts while retaining the same resource during refresh", async () => {
    call.mockResolvedValue(review("before.ts"));
    await render();
    await advance();
    expect(current.value).toEqual(review("before.ts"));
    await render({ revision: "two" });
    expect(current.value).toEqual(review("before.ts"));
    expect(current.refreshing).toBe(true);
    await advance(100);
    await render({ revision: "three" });
    await advance(100);
    await render({ revision: "four" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    call.mockResolvedValue(review("after.ts"));
    await advance();
    expect(call).toHaveBeenCalledTimes(2);
    expect(current.value).toEqual(review("after.ts"));
    await advance(60_000);
    expect(call).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a subsequent retry only after the current attempt has failed", async () => {
    call
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValueOnce(review("recovered.ts"));
    await render();
    await advance();
    expect(current.error).toBe(true);
    await act(async () => current.retry());
    expect(current.error).toBeUndefined();
    await advance();
    expect(current.error).toBe(true);
    await act(async () => current.retry());
    expect(current.error).toBeUndefined();
    await advance();
    expect(current.value).toEqual(review("recovered.ts"));
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("releases successful snapshots when a viewer is disabled", async () => {
    call.mockResolvedValue(review("large-file.ts"));
    await render();
    await advance();
    expect(current.value).toEqual(review("large-file.ts"));
    await render({ enabled: false });
    expect(current.value).toBeUndefined();
    expect(current.error).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await render({ enabled: true });
    expect(current.value).toBeUndefined();
    await advance();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([0, 250])(
    "cancels disabled work after %i ms and reloads once when enabled returns",
    async (elapsed) => {
      const previous = deferred();
      call.mockReturnValue(previous.promise);
      await render();
      await advance(elapsed);
      const signal = call.mock.calls[0]?.[2] as AbortSignal | undefined;
      await render({ enabled: false });
      expect(vi.getTimerCount()).toBe(0);
      if (signal) expect(signal.aborted).toBe(true);
      const callsBefore = call.mock.calls.length;
      await act(async () => {
        current.retry();
        previous.resolve(review("stale.ts"));
      });
      await advance(60_000);
      expect(call).toHaveBeenCalledTimes(callsBefore);
      expect(current.value).toBeUndefined();
      call.mockResolvedValue(review("visible.ts"));
      await render({ enabled: true });
      await advance();
      expect(call).toHaveBeenCalledTimes(callsBefore + 1);
      expect(current.value).toEqual(review("visible.ts"));
    }
  );

  it.each([0, 250])(
    "cleans timers and aborts on unmount after %i ms",
    async (elapsed) => {
      const pending = deferred();
      call.mockReturnValue(pending.promise);
      await render();
      await advance(elapsed);
      const signal = call.mock.calls[0]?.[2] as AbortSignal | undefined;
      await act(async () => root.render(null));
      expect(vi.getTimerCount()).toBe(0);
      if (signal) expect(signal.aborted).toBe(true);
      const count = call.mock.calls.length;
      await act(async () => pending.resolve(review("stale.ts")));
      await advance(60_000);
      expect(call).toHaveBeenCalledTimes(count);
      expect(host.textContent).toBe("");
    }
  );

  it("does not request without a client, and rejects malformed success as error", async () => {
    await render({ client: null });
    await act(async () => current.retry());
    await advance(1000);
    expect(call).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    call.mockResolvedValue({ files: [] });
    await render({ client: { call } as unknown as MobileRpcClient });
    await advance();
    expect(current.error).toBe(true);
    expect(current.value).toBeUndefined();
  });
});

it("keeps the last valid review through refresh failure and deduplicated retry", async () => {
  call
    .mockResolvedValueOnce(review("retained.ts"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(review("updated.ts"));
  await render();
  await advance();
  await render({ revision: "new" });
  await advance();
  expect(current.value).toEqual(review("retained.ts"));
  expect(current.error).toBe(true);
  expect(current.refreshing).toBe(false);
  await act(async () => {
    current.retry();
    current.retry();
  });
  expect(current.value).toEqual(review("retained.ts"));
  expect(current.error).toBeUndefined();
  expect(current.refreshing).toBe(true);
  await advance();
  expect(current.value).toEqual(review("updated.ts"));
  expect(current.refreshing).toBe(false);
  expect(call).toHaveBeenCalledTimes(3);
});

it.each<Partial<Props>>([
  { sessionId: "new-session" },
  { roundId: "new-round" },
  { scope: "workspace" },
  { filePath: "new-file" },
  { client: null },
])(
  "clears successful retained data immediately on identity change %j",
  async (next) => {
    call
      .mockResolvedValueOnce(review("private.ts"))
      .mockReturnValue(new Promise(() => {}));
    await render();
    await advance();
    await render(next);
    expect(current.value).toBeUndefined();
    expect(current.error).toBeUndefined();
    expect(current.refreshing).toBe(false);
  }
);
