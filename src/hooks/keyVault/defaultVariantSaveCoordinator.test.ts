import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyInfo, SaveKeyRequest } from "@src/api/types/keys";

import { saveDefaultVariantOverrides } from "./defaultVariantSaveCoordinator";
import {
  getSharedLocalKeys,
  publishSharedLocalKeys,
} from "./sharedLocalKeyStore";

const mocks = vi.hoisted(() => ({
  saveKey: vi.fn<(request: SaveKeyRequest) => Promise<KeyInfo>>(),
}));
vi.mock("@src/api/services/keyValidation", () => ({
  saveKey: mocks.saveKey,
  listKeys: vi.fn(),
}));

const choice = (model: string, base_model = "family") => ({
  base_model,
  model,
});
function key(defaults = [choice("original")]): KeyInfo {
  return {
    id: "account",
    agent_type: "codex",
    name: "original name",
    default_variants: defaults,
  } as KeyInfo;
}
function deferred() {
  let resolve!: (key: KeyInfo) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<KeyInfo>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function submit(model: string, family = "family") {
  return saveDefaultVariantOverrides({
    id: "account",
    agent_type: "codex",
    default_variant_overrides: [choice(model, family)],
  });
}
const current = () =>
  Object.fromEntries(
    (getSharedLocalKeys()[0]?.default_variants ?? []).map((item) => [
      item.base_model,
      item.model,
    ])
  );
beforeEach(() => {
  vi.clearAllMocks();
  publishSharedLocalKeys([key()]);
});

describe("shared default family write coordinator", () => {
  it("two failed picks roll back to confirmed state, not the earlier optimistic pick", async () => {
    const a = deferred(),
      b = deferred();
    mocks.saveKey.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = submit("a").catch(() => null);
    const second = submit("b").catch(() => null);
    expect(current()).toEqual({ family: "b" });
    expect(mocks.saveKey).toHaveBeenCalledTimes(1);
    a.reject(new Error("a failed"));
    await first;
    expect(current()).toEqual({ family: "b" });
    expect(mocks.saveKey).toHaveBeenCalledTimes(2);
    b.reject(new Error("b failed"));
    await second;
    expect(current()).toEqual({ family: "original" });
  });

  it("an older reply cannot cover a newer pick or overwrite unrelated account fields", async () => {
    const a = deferred(),
      b = deferred();
    mocks.saveKey.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = submit("a");
    const second = submit("b").catch(() => null);
    publishSharedLocalKeys([
      { ...getSharedLocalKeys()[0], name: "renamed elsewhere" },
    ]);
    a.resolve(key([choice("a")]));
    await first;
    expect(current()).toEqual({ family: "b" });
    expect(getSharedLocalKeys()[0].name).toBe("renamed elsewhere");
    b.reject(new Error("b failed"));
    await second;
    expect(current()).toEqual({ family: "a" });
  });

  it("separates families and preserves independent source updates", async () => {
    publishSharedLocalKeys([
      key([choice("original"), choice("provider-b", "other")]),
    ]);
    const a = deferred(),
      b = deferred();
    mocks.saveKey.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = submit("a").catch(() => null);
    const second = submit("b", "other");
    publishSharedLocalKeys([
      {
        ...getSharedLocalKeys()[0],
        default_variants: [
          ...getSharedLocalKeys()[0].default_variants!,
          choice("external", "third"),
        ],
      },
    ]);
    a.reject(new Error("a failed"));
    await first;
    b.resolve(key([choice("original"), choice("b", "other")]));
    await second;
    expect(current()).toEqual({
      family: "original",
      other: "b",
      third: "external",
    });
    expect(mocks.saveKey).toHaveBeenNthCalledWith(2, {
      id: "account",
      agent_type: "codex",
      default_variant_overrides: [choice("b", "other")],
    });
  });

  it("an external choice between failed picks becomes the confirmed rollback baseline", async () => {
    const a = deferred(),
      b = deferred();
    mocks.saveKey.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = submit("a").catch(() => null);
    publishSharedLocalKeys([key([choice("external")])]);
    const second = submit("b").catch(() => null);
    a.reject(new Error("a failed"));
    await first;
    b.reject(new Error("b failed"));
    await second;
    expect(current()).toEqual({ family: "external" });
  });

  it("bounds pending work and releases the lane so retry starts from confirmed state", async () => {
    const a = deferred();
    mocks.saveKey
      .mockReturnValueOnce(a.promise)
      .mockRejectedValue(new Error("failed"));
    const requests = Array.from({ length: 64 }, (_, i) =>
      submit(String(i)).catch(() => null)
    );
    await expect(submit("overflow")).rejects.toThrow("Too many");
    a.reject(new Error("failed"));
    await Promise.all(requests);
    expect(current()).toEqual({ family: "original" });
    // An idle lane would wrongly mask this independent update.
    publishSharedLocalKeys([key([choice("after-idle")])]);
    expect(current()).toEqual({ family: "after-idle" });
    mocks.saveKey.mockResolvedValueOnce(key([choice("retry")]));
    await submit("retry");
    expect(current()).toEqual({ family: "retry" });
  });

  it("a slow account does not block saves for another account", async () => {
    publishSharedLocalKeys([key(), { ...key(), id: "other-account" }]);
    const slow = deferred();
    mocks.saveKey.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({
      ...key([choice("other-pick")]),
      id: "other-account",
    });
    const first = submit("slow-pick");
    await saveDefaultVariantOverrides({
      id: "other-account",
      agent_type: "codex",
      default_variant_overrides: [choice("other-pick")],
    });
    expect(mocks.saveKey).toHaveBeenCalledTimes(2);
    expect(getSharedLocalKeys()[1].default_variants).toEqual([
      choice("other-pick"),
    ]);
    expect(current()).toEqual({ family: "slow-pick" });
    slow.resolve(key([choice("slow-pick")]));
    await first;
  });

  it("deletion stops queued writes and a late response cannot recreate the account", async () => {
    const a = deferred();
    mocks.saveKey.mockReturnValueOnce(a.promise);
    const first = submit("a");
    const second = submit("b").catch(() => null);
    publishSharedLocalKeys([]);
    a.resolve(key([choice("a")]));
    await first;
    await second;
    expect(getSharedLocalKeys()).toEqual([]);
    expect(mocks.saveKey).toHaveBeenCalledTimes(1);
  });
});
