import { describe, expect, it, vi } from "vitest";

import { startDesktopReadStateBridge } from "../desktopReadStateBridge";

describe("Desktop read-state listener lifetime", () => {
  it("releases a listener that resolves after unmount, without installing a store subscriber", async () => {
    let resolve!: (stop: () => void) => void;
    const subscribe = vi.fn(() => () => undefined);
    const notifyChanged = vi.fn(async () => undefined);
    const stopListener = vi.fn();
    const stop = startDesktopReadStateBridge({
      listen: () =>
        new Promise((yes) => {
          resolve = yes;
        }),
      reply: async () => undefined,
      notifyChanged,
      subscribe,
      read: () => new Set(),
      mark: () => undefined,
      onError: vi.fn(),
    });
    stop();
    resolve(stopListener);
    await Promise.resolve();
    expect(stopListener).toHaveBeenCalledTimes(1);
    expect(subscribe).not.toHaveBeenCalled();
    expect(notifyChanged).not.toHaveBeenCalled();
  });
  it("rejects expired and malformed commands before the producing write path", async () => {
    let receive!: (value: unknown) => void;
    const mark = vi.fn();
    const reply = vi.fn(async () => undefined);
    const stop = startDesktopReadStateBridge({
      listen: async (handler) => {
        receive = handler;
        return () => undefined;
      },
      reply,
      notifyChanged: async () => undefined,
      subscribe: () => () => undefined,
      read: () => new Set(),
      mark,
      onError: vi.fn(),
    });
    await Promise.resolve();
    const request = {
      requestId: "r",
      sessionIds: ["a"],
      markVisited: true,
      expiresAtMs: Date.now() - 1,
    };
    receive(request);
    receive({ ...request, expiresAtMs: Date.now() + 5000, sessionIds: [42] });
    expect(mark).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    stop();
  });
});
