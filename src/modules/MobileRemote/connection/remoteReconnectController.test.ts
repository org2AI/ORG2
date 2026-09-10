import { afterEach, describe, expect, it, vi } from "vitest";

import { createRemoteReconnectController } from "./remoteReconnectController";

describe("remoteReconnectController", () => {
  afterEach(() => vi.useRealTimers());
  it("shares repeated recovery and drops superseded or hidden schedules", async () => {
    vi.useFakeTimers();
    let hidden = false;
    let generation = 1;
    let finish!: () => void;
    const recover = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const controller = createRemoteReconnectController(
      {
        isHidden: () => hidden,
        random: () => 0,
        setTimeout: (fn, delay) => setTimeout(fn, delay) as unknown as number,
        clearTimeout: (id) => clearTimeout(id),
      },
      (current) => current === generation,
      recover
    );
    const config = { wsUrl: "wss://relay.example/ws" };
    const first = controller.run(config, 1);
    expect(controller.run(config, 1)).toBe(first);
    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
    finish();
    await first;
    controller.schedule(config, 1);
    controller.schedule(config, 1);
    expect(vi.getTimerCount()).toBe(1);
    generation = 2;
    await vi.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);
    hidden = true;
    controller.schedule(config, 2);
    await controller.run(config, 2);
    expect(vi.getTimerCount()).toBe(0);
    expect(recover).toHaveBeenCalledTimes(1);
    hidden = false;
    controller.schedule(config, 2);
    controller.invalidate();
    expect(vi.getTimerCount()).toBe(0);
    const cancelled = controller.run(config, 2);
    controller.invalidate();
    await cancelled;
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
