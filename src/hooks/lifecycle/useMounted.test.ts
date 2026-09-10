/* @vitest-environment jsdom */
import type { RefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import { useMounted } from "./useMounted";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

describe("useMounted", () => {
  it("stays true through StrictMode's simulated remount and flips on unmount", async () => {
    const harness = createHookLifecycleHarness((_props: object) =>
      useMounted()
    );
    cleanup.push(harness.unmount);

    await harness.render({});
    const mountedRef: RefObject<boolean> = harness.read();
    expect(mountedRef.current).toBe(true);

    await harness.render({});
    expect(mountedRef.current).toBe(true);

    await harness.unmount();
    expect(mountedRef.current).toBe(false);
  });
});
