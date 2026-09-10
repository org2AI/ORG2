import { describe, expect, it, vi } from "vitest";

import { codexAppContextUsage } from "./index";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("Codex context reads", () => {
  it("coalesces hydration and manual refresh, then reads fresh next time", async () => {
    let resolve!: (value: null) => void;
    invoke.mockReturnValueOnce(
      new Promise<null>((done) => {
        resolve = done;
      })
    );
    const first = codexAppContextUsage("codexapp-one");
    expect(codexAppContextUsage("codexapp-one")).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve(null);
    await first;
    invoke.mockResolvedValueOnce(null);
    await codexAppContextUsage("codexapp-one");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("bounds concurrent reads and releases entries after errors", async () => {
    let reject!: (error: Error) => void;
    const deferred = new Promise((_, fail) => {
      reject = fail;
    });
    invoke.mockReturnValue(deferred);
    const requests = Array.from({ length: 8 }, (_, i) =>
      codexAppContextUsage(`codexapp-${i}`)
    );
    const settled = Promise.allSettled(requests);
    await expect(codexAppContextUsage("codexapp-overflow")).rejects.toThrow(
      "busy"
    );
    reject(new Error("read failed"));
    await settled;
    invoke.mockResolvedValue(null);
    await expect(codexAppContextUsage("codexapp-overflow")).resolves.toBeNull();
  });
});
