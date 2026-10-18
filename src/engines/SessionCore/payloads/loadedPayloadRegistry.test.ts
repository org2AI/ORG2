import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLoadedPayloads,
  getLoadedPayload,
  getLoadedPayloadStats,
  getPayloadRegistryKey,
  getPendingPayloadLoad,
  trackPendingPayloadLoad,
  unloadPayload,
} from "./loadedPayloadRegistry";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(clearLoadedPayloads);
describe("payload request ownership", () => {
  it("shares one actual read and resolved body", async () => {
    const read = vi.fn(async () => "body");
    const first = trackPendingPayloadLoad("k", read);
    expect(trackPendingPayloadLoad("k", read)).toBe(first);
    expect(await first).toBe("body");
    expect(read).toHaveBeenCalledTimes(1);
    expect(getLoadedPayload("k")).toBe("body");
    expect(getPendingPayloadLoad("k")).toBeNull();
  });
  it("does not start I/O cleared before dispatch", async () => {
    const read = vi.fn(async () => "body");
    const work = trackPendingPayloadLoad("k", read);
    clearLoadedPayloads();
    expect(await work).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("old completion cannot remove a current pending load or restore a cleared body", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const a = trackPendingPayloadLoad("k", () => old.promise);
    await Promise.resolve();
    clearLoadedPayloads();
    const b = trackPendingPayloadLoad("k", () => fresh.promise);
    old.resolve("old");
    expect(await a).toBeNull();
    expect(getPendingPayloadLoad("k")).toBe(b);
    expect(getLoadedPayload("k")).toBeNull();
    fresh.resolve("fresh");
    expect(await b).toBe("fresh");
  });
  it("an old response arriving last cannot overwrite the new body", async () => {
    const old = deferred<string>();
    const a = trackPendingPayloadLoad("k", () => old.promise);
    await Promise.resolve();
    clearLoadedPayloads();
    await trackPendingPayloadLoad("k", async () => "fresh");
    old.resolve("old");
    expect(await a).toBeNull();
    expect(getLoadedPayload("k")).toBe("fresh");
  });
  it("unloads one in-flight key without invalidating another", async () => {
    const old = deferred<string>();
    const a = trackPendingPayloadLoad("a", () => old.promise);
    await Promise.resolve();
    await trackPendingPayloadLoad("b", async () => "other");
    unloadPayload("a");
    old.resolve("old");
    expect(await a).toBeNull();
    expect(getLoadedPayload("b")).toBe("other");
  });
  it("surfaces current errors, releases flight, and retries", async () => {
    await expect(
      trackPendingPayloadLoad("k", async () => {
        throw new Error("read failed");
      })
    ).rejects.toThrow("read failed");
    expect(getPendingPayloadLoad("k")).toBeNull();
    expect(await trackPendingPayloadLoad("k", async () => "retry")).toBe(
      "retry"
    );
  });
  it("drops an invalidated request error", async () => {
    const old = deferred<string>();
    const work = trackPendingPayloadLoad("k", () => old.promise);
    await Promise.resolve();
    clearLoadedPayloads();
    old.reject(new Error("obsolete"));
    expect(await work).toBeNull();
  });
  it("retains the entry and byte bounds", async () => {
    for (let i = 0; i < 8; i++)
      await trackPendingPayloadLoad(String(i), async () => "x");
    expect(getLoadedPayloadStats().entries).toBe(6);
    await trackPendingPayloadLoad("large", async () =>
      "x".repeat(5 * 1024 * 1024)
    );
    expect(getLoadedPayloadStats().bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
  it("separates keys even when components contain colons", () => {
    expect(getPayloadRegistryKey("a:b", "c", "d")).not.toBe(
      getPayloadRegistryKey("a", "b:c", "d")
    );
  });
});
