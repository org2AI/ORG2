import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listKeys: vi.fn(),
  replaceAliases: vi.fn(),
}));

vi.mock("@src/api/services/keyValidation", () => ({
  listKeys: mocks.listKeys,
}));

vi.mock("@src/hooks/models/modelAliasRegistry", () => ({
  replaceModelAliasesFromKeys: mocks.replaceAliases,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("shared local key store", () => {
  it("publishes one-account health updates without reloading the vault", async () => {
    const store = await import("./sharedLocalKeyStore");
    const listener = vi.fn();
    const unsubscribe = store.subscribeSharedLocalKeys(listener);
    const ready = { id: "codex-account", health_status: "valid" };
    const invalid = { id: "codex-account", health_status: "invalid" };

    store.publishSharedLocalKeys([ready] as never);
    mocks.listKeys.mockClear();
    listener.mockClear();

    store.upsertSharedLocalKey(invalid as never);

    expect(store.getSharedLocalKeys()).toEqual([invalid]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([invalid]);
    expect(mocks.replaceAliases).toHaveBeenCalledWith([invalid]);
    expect(mocks.listKeys).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("joins concurrent loads, caches auto-loads, and allows a forced refresh", async () => {
    let resolveFirst: ((keys: Array<{ id: string }>) => void) | undefined;
    const firstKeys = [{ id: "key-1" }];
    const secondKeys = [{ id: "key-2" }];
    mocks.listKeys
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce(secondKeys);

    const store = await import("./sharedLocalKeyStore");
    const first = store.loadSharedLocalKeys();
    const joined = store.loadSharedLocalKeys();

    expect(mocks.listKeys).toHaveBeenCalledTimes(1);
    resolveFirst?.(firstKeys);
    await expect(first).resolves.toEqual(firstKeys);
    await expect(joined).resolves.toEqual(firstKeys);

    await expect(store.loadSharedLocalKeys()).resolves.toEqual(firstKeys);
    expect(mocks.listKeys).toHaveBeenCalledTimes(1);

    await expect(store.loadSharedLocalKeys(true)).resolves.toEqual(secondKeys);
    expect(mocks.listKeys).toHaveBeenCalledTimes(2);
    expect(store.getSharedLocalKeys()).toEqual(secondKeys);
    expect(mocks.replaceAliases).toHaveBeenLastCalledWith(secondKeys);
  });
});
