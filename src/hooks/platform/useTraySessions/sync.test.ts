import { describe, expect, it, vi } from "vitest";

import { createTraySync } from "./sync";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createTraySync", () => {
  it("serializes writes, coalesces to the newest snapshot, and skips identical payloads", async () => {
    let finish!: () => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const sync = createTraySync(write, vi.fn());
    sync.update("first");
    sync.update("obsolete");
    sync.update("latest");
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await tick();
    expect(write.mock.calls.map(([value]) => value)).toEqual([
      "first",
      "latest",
    ]);
    sync.update("latest");
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("discards queued writes on disposal", async () => {
    let finish!: () => void;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const sync = createTraySync(write, vi.fn());
    sync.update("first");
    sync.update("queued");
    sync.stop();
    finish();
    await tick();
    sync.update("after cleanup");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports errors and allows the next invalidation to retry", async () => {
    const error = new Error("native update failed");
    const write = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const report = vi.fn();
    const sync = createTraySync(write, report);
    sync.update("snapshot");
    await tick();
    sync.update("snapshot");
    await tick();
    expect(report).toHaveBeenCalledWith(error);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
