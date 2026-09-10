/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeepAliveWindow } from "@src/hooks/ui/useKeepAliveWindow";
import { useMouseMoved } from "@src/hooks/ui/useMouseMoved";

import { createHookLifecycleHarness } from "./hookLifecycleHarness";
import { dispatch, settle } from "./reactSmokeHarness";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("production hook lifecycle contracts", () => {
  it("balances subscriptions through StrictMode, hidden state and remount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const harness = createHookLifecycleHarness(
      ({ visible }: { visible: boolean }) => useMouseMoved(visible)
    );
    cleanup.push(harness.unmount);
    const registrations = () =>
      add.mock.calls.filter(([event]) => event === "mousemove");
    const removals = () =>
      remove.mock.calls.filter(([event]) => event === "mousemove");
    const balance = () => registrations().length - removals().length;

    for (let cycle = 0; cycle < 3; cycle++) {
      await harness.render({ visible: true });
      expect(balance()).toBe(1);
      await harness.render({ visible: true });
      expect(balance()).toBe(1);
      expect(harness.read().current).toBe(false);
      await dispatch(() => window.dispatchEvent(new MouseEvent("mousemove")));
      expect(harness.read().current).toBe(true);
      await harness.render({ visible: false });
      expect(balance()).toBe(0);
      expect(harness.read().current).toBe(false);
      await harness.render({ visible: true });
      expect(balance()).toBe(1);
      await harness.unmount();
      expect(balance()).toBe(0);
      expect(() => harness.read()).toThrow("Render the hook");
    }
    // Verify callback identity, not just matching add/remove totals.
    for (const [, callback] of registrations()) {
      expect(removals().some(([, removed]) => removed === callback)).toBe(true);
    }
  });

  it("bounds warm state and leaves no grace timer after repeated unmounts", async () => {
    vi.useFakeTimers();
    const present = ["a", "b", "c"];
    const harness = createHookLifecycleHarness(
      ({ active }: { active: string | null }) =>
        useKeepAliveWindow(active, present, { graceMs: 100, maxWarm: 2 })
    );
    cleanup.push(harness.unmount);
    const baselineTimers = vi.getTimerCount();
    for (let cycle = 0; cycle < 3; cycle++) {
      await harness.render({ active: "a" });
      expect([...harness.read()]).toEqual(["a"]);
      expect(vi.getTimerCount()).toBe(baselineTimers);
      await harness.render({ active: "b" });
      expect(harness.read().size).toBe(2);
      expect(vi.getTimerCount()).toBe(baselineTimers + 1);
      await harness.render({ active: "c" });
      expect([...harness.read()]).toEqual(["b", "c"]);
      expect(vi.getTimerCount()).toBe(baselineTimers + 1);
      await harness.render({ active: null });
      await settle(101);
      expect(harness.read().size).toBe(0);
      expect(vi.getTimerCount()).toBe(baselineTimers);
      await harness.render({ active: "a" });
      await harness.render({ active: "b" });
      await harness.unmount();
      expect(vi.getTimerCount()).toBe(baselineTimers);
      await settle(1_000);
      expect(vi.getTimerCount()).toBe(baselineTimers);
    }
  });
});
