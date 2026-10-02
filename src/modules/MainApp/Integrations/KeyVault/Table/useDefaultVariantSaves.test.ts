// @vitest-environment jsdom
import React, { act, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyInfo, SaveKeyRequest } from "@src/api/types/keys";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { saveDefaultVariantOverrides } from "@src/hooks/keyVault/defaultVariantSaveCoordinator";
import {
  getSharedLocalKeys,
  publishSharedLocalKeys,
  subscribeSharedLocalKeys,
} from "@src/hooks/keyVault/sharedLocalKeyStore";

import { useDefaultVariantSaves } from "./useDefaultVariantSaves";

const fixture = vi.hoisted(() => ({
  saveKey: vi.fn<(request: SaveKeyRequest) => Promise<KeyInfo>>(),
}));
vi.mock("@src/api/services/keyValidation", () => ({
  saveKey: fixture.saveKey,
}));

const account: KeyVaultAccount = {
  id: "account",
  name: "Fixture",
  modelType: "codex",
  status: "ready",
  enabled: true,
  hasLocalKey: true,
  isListed: false,
  hasKey: true,
  hasApiKey: false,
  hasSessionToken: true,
  defaultVariants: [
    { base_model: "family-a", model: "a-provider-default" },
    { base_model: "family-b", model: "b-provider-default" },
  ],
};
const cleanups: Array<() => void> = [];
function setup() {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const resultRef: { current?: ReturnType<typeof useDefaultVariantSaves> } = {};
  function Probe() {
    const keys = useSyncExternalStore(
      subscribeSharedLocalKeys,
      getSharedLocalKeys
    );
    const result = useDefaultVariantSaves({
      accounts: keys.map((key) => ({
        ...account,
        defaultVariants: key.default_variants,
      })),
      onRefresh,
    });
    useEffect(() => {
      resultRef.current = result;
    }, [result]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(React.createElement(Probe)));
  let mounted = true;
  const unmount = () => {
    if (mounted) {
      act(() => root.unmount());
      mounted = false;
    }
  };
  cleanups.push(unmount);
  if (!resultRef.current) throw new Error("Hook did not render");
  return { hook: resultRef.current, onRefresh, unmount };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  publishSharedLocalKeys([
    {
      id: "account",
      agent_type: "codex",
      default_variants: account.defaultVariants,
    } as KeyInfo,
  ]);
  fixture.saveKey.mockImplementation(
    async (request) =>
      ({
        id: "account",
        agent_type: "codex",
        default_variants: request.default_variant_overrides,
      }) as KeyInfo
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});

describe("family-scoped default variant persistence", () => {
  it("does not serialize unedited provider defaults as user overrides", async () => {
    const { hook } = setup();
    act(() =>
      hook.updateDefaultVariant("account", "family-a", "a-user-choice")
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fixture.saveKey).toHaveBeenCalledExactlyOnceWith({
      id: "account",
      agent_type: "codex",
      default_variant_overrides: [
        { base_model: "family-a", model: "a-user-choice" },
      ],
    });
    expect(getSharedLocalKeys()[0].default_variants).toContainEqual({
      base_model: "family-a",
      model: "a-user-choice",
    });
  });

  it("coalesces repeated picks and includes only explicitly edited families", async () => {
    const { hook } = setup();
    act(() => {
      hook.updateDefaultVariant("account", "family-a", "earlier");
      hook.updateDefaultVariant("account", "family-a", "latest");
      hook.updateDefaultVariant("account", "family-c", "new-choice");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fixture.saveKey).toHaveBeenCalledExactlyOnceWith({
      id: "account",
      agent_type: "codex",
      default_variant_overrides: [
        { base_model: "family-a", model: "latest" },
        { base_model: "family-c", model: "new-choice" },
      ],
    });
  });

  it("reloads authoritative data after failure and permits a fresh family-only retry", async () => {
    fixture.saveKey.mockRejectedValueOnce(new Error("write failed"));
    const { hook, onRefresh } = setup();
    act(() =>
      hook.updateDefaultVariant("account", "family-a", "failed-choice")
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getSharedLocalKeys()[0].default_variants).toEqual(
      account.defaultVariants
    );
    act(() => hook.updateDefaultVariant("account", "family-b", "retry-choice"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fixture.saveKey).toHaveBeenLastCalledWith({
      id: "account",
      agent_type: "codex",
      default_variant_overrides: [
        { base_model: "family-b", model: "retry-choice" },
      ],
    });
  });

  it("unmount flush joins the same in-flight writer and survives table disposal", async () => {
    let resolveFirst!: (key: KeyInfo) => void;
    let resolveSecond!: (key: KeyInfo) => void;
    fixture.saveKey
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );
    const { hook, unmount } = setup();
    let first!: Promise<KeyInfo>;
    act(() => {
      first = saveDefaultVariantOverrides({
        id: "account",
        agent_type: "codex",
        default_variant_overrides: [{ base_model: "family-a", model: "first" }],
      });
      hook.updateDefaultVariant("account", "family-a", "last-before-close");
    });
    // No debounce elapsed; leaving the table hands its last click to the
    // same coordinator already serving the other picker surface.
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(fixture.saveKey).toHaveBeenCalledTimes(1);
    expect(getSharedLocalKeys()[0].default_variants).toContainEqual({
      base_model: "family-a",
      model: "last-before-close",
    });
    resolveFirst({
      id: "account",
      agent_type: "codex",
      default_variants: [{ base_model: "family-a", model: "first" }],
    } as KeyInfo);
    await first;
    expect(fixture.saveKey).toHaveBeenCalledTimes(2);
    expect(getSharedLocalKeys()[0].default_variants).toContainEqual({
      base_model: "family-a",
      model: "last-before-close",
    });
    resolveSecond({
      id: "account",
      agent_type: "codex",
      default_variants: [
        { base_model: "family-a", model: "last-before-close" },
      ],
    } as KeyInfo);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSharedLocalKeys()[0].default_variants).toContainEqual({
      base_model: "family-a",
      model: "last-before-close",
    });
  });
});
