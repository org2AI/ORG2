// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type UseCopyCheckOptions,
  useCopyCheck,
  useKeyedCopyCheck,
} from "./useCopyCheck";

type CopyCheckResult = ReturnType<typeof useCopyCheck>;
type KeyedResult = ReturnType<typeof useKeyedCopyCheck<string>>;

let latest: CopyCheckResult | null = null;
let latestKeyed: KeyedResult | null = null;

function Harness({
  onCopy,
  options,
}: {
  onCopy: () => Promise<void>;
  options?: UseCopyCheckOptions;
}) {
  const result = useCopyCheck(onCopy, options);
  // Publish from an effect (not during render) so the harness stays a valid
  // component under the react-hooks lint rules.
  useEffect(() => {
    latest = result;
  }, [result]);
  return null;
}

function KeyedHarness({
  onCopy,
  options,
}: {
  onCopy: (key: string) => Promise<void>;
  options?: UseCopyCheckOptions;
}) {
  const result = useKeyedCopyCheck(onCopy, options);
  useEffect(() => {
    latestKeyed = result;
  }, [result]);
  return null;
}

async function flushCopy() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useCopyCheck", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    latest = null;
    latestKeyed = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("flips copied on success and reverts after the default 5 s", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(createElement(Harness, { onCopy })));
    expect(latest?.copied).toBe(false);

    act(() => latest?.handleCopy());
    await flushCopy();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(latest?.copied).toBe(true);

    act(() => vi.advanceTimersByTime(4_999));
    expect(latest?.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(latest?.copied).toBe(false);
  });

  it("honours a custom durationMs", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        createElement(Harness, { onCopy, options: { durationMs: 1_500 } })
      )
    );

    act(() => latest?.handleCopy());
    await flushCopy();
    expect(latest?.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1_499));
    expect(latest?.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(latest?.copied).toBe(false);
  });

  it("leaves copied false when the copy rejects", async () => {
    const onCopy = vi.fn().mockRejectedValue(new Error("denied"));
    act(() => root.render(createElement(Harness, { onCopy })));

    act(() => latest?.handleCopy());
    await flushCopy();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(latest?.copied).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the pending revert timer on unmount", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    act(() => root.render(createElement(Harness, { onCopy })));

    act(() => latest?.handleCopy());
    await flushCopy();
    expect(latest?.copied).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);

    // afterEach unmounts again; give it a fresh root so that stays valid.
    root = createRoot(container);
  });

  it("does not schedule a timer when the copy settles after unmount", async () => {
    const pending: { resolve: () => void } = { resolve: () => {} };
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pending.resolve = resolve;
        })
    );
    act(() => root.render(createElement(Harness, { onCopy })));

    act(() => latest?.handleCopy());
    act(() => root.unmount());
    pending.resolve();
    await flushCopy();
    expect(vi.getTimerCount()).toBe(0);

    root = createRoot(container);
  });

  describe("useKeyedCopyCheck", () => {
    it("tracks which key was copied and restarts the timer on a new key", async () => {
      const onCopy = vi.fn((_key: string) => Promise.resolve());
      act(() =>
        root.render(
          createElement(KeyedHarness, {
            onCopy,
            options: { durationMs: 1_500 },
          })
        )
      );
      expect(latestKeyed?.copiedKey).toBeNull();

      act(() => latestKeyed?.handleCopy("row-a"));
      await flushCopy();
      expect(onCopy).toHaveBeenCalledWith("row-a");
      expect(latestKeyed?.copiedKey).toBe("row-a");

      act(() => vi.advanceTimersByTime(1_000));
      act(() => latestKeyed?.handleCopy("row-b"));
      await flushCopy();
      expect(latestKeyed?.copiedKey).toBe("row-b");
      expect(vi.getTimerCount()).toBe(1);

      // The first row's timer was replaced, so row-b outlives row-a's deadline.
      act(() => vi.advanceTimersByTime(1_000));
      expect(latestKeyed?.copiedKey).toBe("row-b");
      act(() => vi.advanceTimersByTime(500));
      expect(latestKeyed?.copiedKey).toBeNull();
    });

    it("reset() ends the flash early and cancels the timer", async () => {
      const onCopy = vi.fn((_key: string) => Promise.resolve());
      act(() => root.render(createElement(KeyedHarness, { onCopy })));

      act(() => latestKeyed?.handleCopy("row-a"));
      await flushCopy();
      expect(latestKeyed?.copiedKey).toBe("row-a");

      act(() => latestKeyed?.reset());
      expect(latestKeyed?.copiedKey).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps the previous key when copying a new one fails", async () => {
      const onCopy = vi.fn((key: string) =>
        key === "bad" ? Promise.reject(new Error("denied")) : Promise.resolve()
      );
      act(() => root.render(createElement(KeyedHarness, { onCopy })));

      act(() => latestKeyed?.handleCopy("row-a"));
      await flushCopy();
      act(() => latestKeyed?.handleCopy("bad"));
      await flushCopy();
      expect(latestKeyed?.copiedKey).toBe("row-a");
    });
  });
});
