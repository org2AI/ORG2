import { beforeEach, describe, expect, it, vi } from "vitest";

const moduleFactory = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.resetModules();
  moduleFactory.mockReset();
  vi.doMock("./SessionHoverCardContent", () => moduleFactory());
});

describe("loadSessionHoverCardContent", () => {
  it("shares one pending import and caches only the resolved component", async () => {
    const Component = () => null;
    let resolve!: (module: {
      SessionHoverCardContent: typeof Component;
    }) => void;
    moduleFactory.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const loader = await import("./loadSessionHoverCardContent");
    expect(moduleFactory).not.toHaveBeenCalled();
    expect(loader.getLoadedSessionHoverCardContent()).toBeNull();

    const first = loader.loadSessionHoverCardContent();
    const second = loader.loadSessionHoverCardContent();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(moduleFactory).toHaveBeenCalledTimes(1));
    resolve({ SessionHoverCardContent: Component });
    await expect(first).resolves.toBe(Component);
    expect(loader.getLoadedSessionHoverCardContent()).toBe(Component);
    await expect(loader.loadSessionHoverCardContent()).resolves.toBe(Component);
    expect(moduleFactory).toHaveBeenCalledTimes(1);
  });

  it("releases failed in-flight state so another hover can request the chunk", async () => {
    moduleFactory.mockRejectedValue(new Error("chunk unavailable"));
    const loader = await import("./loadSessionHoverCardContent");
    const first = loader.loadSessionHoverCardContent();
    await expect(first).rejects.toThrow();
    expect(loader.getLoadedSessionHoverCardContent()).toBeNull();
    const Component = () => null;
    vi.doMock("./SessionHoverCardContent", () => ({
      SessionHoverCardContent: Component,
    }));
    const next = loader.loadSessionHoverCardContent();
    expect(next).not.toBe(first);
    await expect(next).resolves.toBe(Component);
    expect(loader.getLoadedSessionHoverCardContent()).toBe(Component);
  });
});
