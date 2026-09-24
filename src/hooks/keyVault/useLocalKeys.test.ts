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

import type { KeyInfo, SaveKeyRequest } from "@src/api/services/keyValidation";

import { useLocalKeys } from "./useLocalKeys";

const mocks = vi.hoisted(() => ({
  listKeys: vi.fn<() => Promise<KeyInfo[]>>(),
  saveKey: vi.fn<(request: SaveKeyRequest) => Promise<KeyInfo>>(),
}));

vi.mock("@src/api/services/keyValidation", () => ({
  listKeys: mocks.listKeys,
  archiveCursorBillingUsageCache: vi.fn(),
  deleteKey: vi.fn(),
  getFullKey: vi.fn(),
  getKey: vi.fn(),
  refreshKeyQuota: vi.fn(),
  saveKey: mocks.saveKey,
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

describe("useLocalKeys default family deltas", () => {
  it("updates the display immediately while sending only the edited family", async () => {
    const key = {
      ...keyRecord("delta-key"),
      default_variants: [
        { base_model: "family-a", model: "provider-a" },
        { base_model: "family-b", model: "provider-b" },
      ],
    };
    mocks.listKeys.mockResolvedValueOnce([key]);
    const result = renderLocalKeys();
    await act(async () => {
      await result.current.refreshAgents(true);
    });
    const save = deferred<KeyInfo>();
    mocks.saveKey.mockReturnValueOnce(save.promise);
    let pending!: Promise<KeyInfo | null>;
    act(() => {
      pending = result.current.saveKey({
        id: key.id,
        agent_type: key.agent_type,
        default_variant_overrides: [
          { base_model: "family-a", model: "chosen-a" },
        ],
      });
    });
    expect(result.current.allKeys[0].default_variants).toEqual([
      { base_model: "family-a", model: "chosen-a" },
      { base_model: "family-b", model: "provider-b" },
    ]);
    expect(mocks.saveKey).toHaveBeenLastCalledWith({
      id: key.id,
      agent_type: key.agent_type,
      default_variant_overrides: [
        { base_model: "family-a", model: "chosen-a" },
      ],
    });
    await act(async () => {
      save.resolve({
        ...key,
        default_variants: [
          { base_model: "family-a", model: "chosen-a" },
          { base_model: "family-b", model: "provider-b" },
        ],
      });
      await pending;
    });
  });

  it("a rejected family pick preserves independently refreshed defaults and accounts", async () => {
    const key = {
      ...keyRecord("delta-key"),
      default_variants: [
        { base_model: "family-a", model: "provider-a" },
        { base_model: "family-b", model: "provider-b" },
      ],
    };
    mocks.listKeys.mockResolvedValueOnce([key]);
    const result = renderLocalKeys();
    await act(async () => {
      await result.current.refreshAgents(true);
    });
    let reject!: (error: Error) => void;
    mocks.saveKey.mockReturnValueOnce(
      new Promise((_resolve, no) => {
        reject = no;
      })
    );
    let pending!: Promise<KeyInfo | null>;
    act(() => {
      pending = result.current.saveKey({
        id: key.id,
        agent_type: key.agent_type,
        default_variant_overrides: [
          { base_model: "family-a", model: "failed-a" },
        ],
      });
    });
    mocks.listKeys.mockResolvedValueOnce([
      {
        ...key,
        default_variants: [
          { base_model: "family-a", model: "failed-a" },
          { base_model: "family-b", model: "newer-b" },
        ],
      },
      keyRecord("new-account"),
    ]);
    await act(async () => {
      await result.current.refreshAgents(true);
    });
    await act(async () => {
      reject(new Error("failed"));
      await pending;
    });
    expect(result.current.allKeys).toHaveLength(2);
    expect(result.current.allKeys[0].default_variants).toEqual([
      { base_model: "family-a", model: "provider-a" },
      { base_model: "family-b", model: "newer-b" },
    ]);
  });
});
