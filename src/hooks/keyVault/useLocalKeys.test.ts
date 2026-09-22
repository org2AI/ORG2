// @vitest-environment jsdom
/**
 * Loading semantics of useLocalKeys.
 *
 * A table body is swapped for a placeholder while `loading` is true, which
 * unmounts every row and drops the UI state inside expanded rows. Only a
 * first load may do that — revalidations after a key write must keep the
 * rendered rows on screen.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyInfo } from "@src/api/services/keyValidation";

import { useLocalKeys } from "./useLocalKeys";

const mocks = vi.hoisted(() => ({
  listKeys: vi.fn<() => Promise<KeyInfo[]>>(),
}));

vi.mock("@src/api/services/keyValidation", () => ({
  listKeys: mocks.listKeys,
  archiveCursorBillingUsageCache: vi.fn(),
  deleteKey: vi.fn(),
  getFullKey: vi.fn(),
  getKey: vi.fn(),
  refreshKeyQuota: vi.fn(),
  saveKey: vi.fn(),
  updateKeyHealth: vi.fn(),
  validateKey: vi.fn(),
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

function keyRecord(id: string): KeyInfo {
  return { id, agent_type: "openai", has_local_key: true } as KeyInfo;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const cleanups: Array<() => void> = [];

function renderHook<T>(hook: () => T) {
  const resultRef = { current: undefined as unknown as T };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    resultRef.current = hook();
    return null;
  }
  act(() => root.render(React.createElement(Probe)));
  cleanups.push(() => act(() => root.unmount()));
  return resultRef;
}

const renderLocalKeys = () =>
  renderHook(() => useLocalKeys({ autoDetect: false }));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("useLocalKeys loading", () => {
  it("shows loading for the first load only, never for a revalidation", async () => {
    const first = deferred<KeyInfo[]>();
    mocks.listKeys.mockReturnValueOnce(first.promise);

    const result = renderLocalKeys();
    expect(result.current.loading).toBe(false);

    let firstLoad!: Promise<void>;
    act(() => {
      firstLoad = result.current.refreshAgents(true);
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      first.resolve([keyRecord("key-1")]);
      await firstLoad;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.allKeys).toHaveLength(1);

    // What a key write triggers: the rows are already on screen, so the
    // reload must not blank them.
    const second = deferred<KeyInfo[]>();
    mocks.listKeys.mockReturnValueOnce(second.promise);
    let revalidation!: Promise<void>;
    act(() => {
      revalidation = result.current.refreshAgents(true);
    });
    expect(result.current.loading).toBe(false);

    await act(async () => {
      second.resolve([keyRecord("key-1"), keyRecord("key-2")]);
      await revalidation;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.allKeys).toHaveLength(2);
  });

  it("stays quiet for a consumer mounted after the keys were loaded", async () => {
    // Prime the shared store the way the app does before the page opens.
    mocks.listKeys.mockResolvedValueOnce([keyRecord("key-1")]);
    const primer = renderLocalKeys();
    await act(async () => {
      await primer.current.refreshAgents(true);
    });

    const late = deferred<KeyInfo[]>();
    mocks.listKeys.mockReturnValueOnce(late.promise);
    const result = renderLocalKeys();
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshAgents(true);
    });
    expect(result.current.loading).toBe(false);

    await act(async () => {
      late.resolve([keyRecord("key-1")]);
      await refresh;
    });
    expect(result.current.loading).toBe(false);
  });
});
