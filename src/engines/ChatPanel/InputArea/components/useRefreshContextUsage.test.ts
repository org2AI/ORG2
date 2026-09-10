import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import type { PostLoadResult } from "@src/engines/SessionCore/sync/types";
import {
  sessionContextTokensAtom,
  sessionContextUsageAtom,
} from "@src/store/session/cliSessionStatusAtom";

import { refreshSessionContextUsage } from "./useRefreshContextUsage";

const { postLoad } = vi.hoisted(() => ({ postLoad: vi.fn() }));
vi.mock("@src/engines/SessionCore/sync/types", () => ({
  getAdapterForSession: () => ({ postLoad }),
}));

vi.mock("@src/api/tauri/externalHistory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/api/tauri/externalHistory")>()),
  getImportedHistorySourceBySessionId: () => undefined,
}));

function pending() {
  let resolve!: (value: PostLoadResult) => void;
  const promise = new Promise<PostLoadResult>((done) => {
    resolve = done;
  });
  postLoad.mockReturnValue(promise);
  return resolve;
}

describe("context refresh lifecycle", () => {
  beforeEach(() => postLoad.mockReset());
  it("shares the active request across controls and releases it after completion", async () => {
    const store = createStore();
    store.set(sessionIdAtom, "codexapp-a");
    const resolve = pending();
    const first = refreshSessionContextUsage(
      store,
      "codexapp-a",
      new AbortController().signal
    );
    await refreshSessionContextUsage(
      store,
      "codexapp-a",
      new AbortController().signal
    );
    expect(postLoad).toHaveBeenCalledTimes(1);
    resolve({ contextTokens: 120, contextUsage: null });
    await first;
    expect(store.get(sessionContextTokensAtom)).toBe(120);
    await refreshSessionContextUsage(
      store,
      "codexapp-a",
      new AbortController().signal
    );
    expect(postLoad).toHaveBeenCalledTimes(2);
  });
  it("discards a request aborted on session switch or unmount", async () => {
    const store = createStore();
    store.set(sessionIdAtom, "codexapp-a");
    const resolve = pending();
    const controller = new AbortController();
    const request = refreshSessionContextUsage(
      store,
      "codexapp-a",
      controller.signal
    );
    controller.abort();
    resolve({ contextTokens: 999 });
    await request;
    expect(store.get(sessionContextTokensAtom)).toBe(0);
  });
  it("does not overwrite newer live telemetry", async () => {
    const store = createStore();
    store.set(sessionIdAtom, "codexapp-a");
    const resolve = pending();
    const request = refreshSessionContextUsage(
      store,
      "codexapp-a",
      new AbortController().signal
    );
    store.set(sessionContextTokensAtom, 200);
    resolve({ contextTokens: 120 });
    await request;
    expect(store.get(sessionContextTokensAtom)).toBe(200);
  });
  it("rejects cross-session results even before effect cleanup", async () => {
    const store = createStore();
    store.set(sessionIdAtom, "codexapp-a");
    const resolve = pending();
    const request = refreshSessionContextUsage(
      store,
      "codexapp-a",
      new AbortController().signal
    );
    store.set(sessionIdAtom, "codexapp-b");
    resolve({ contextTokens: 120 });
    await request;
    expect(store.get(sessionContextTokensAtom)).toBe(0);
  });
  it("releases failed requests so a manual retry can succeed", async () => {
    const store = createStore();
    store.set(sessionIdAtom, "codexapp-a");
    postLoad.mockRejectedValueOnce(new Error("read failed"));
    await expect(
      refreshSessionContextUsage(
        store,
        "codexapp-a",
        new AbortController().signal
      )
    ).rejects.toThrow("read failed");
    postLoad.mockResolvedValue({ contextTokens: 0, contextUsage: null });
    await refreshSessionContextUsage(
      store,
      "codexapp-a",
      new AbortController().signal
    );
    expect(postLoad).toHaveBeenCalledTimes(2);
    expect(store.get(sessionContextUsageAtom)).toBeNull();
  });
});
