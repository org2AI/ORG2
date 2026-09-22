import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  serializedCloudOwner,
  suspendNativeCloudOwner,
  synchronizeNativeCloudOwner,
} from "./nativeCloudOwner";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("native Cloud owner bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("passes only the native epoch, never frontend identity or credentials", async () => {
    invoke.mockResolvedValueOnce(42).mockResolvedValueOnce(null);
    const epoch = await suspendNativeCloudOwner();
    await synchronizeNativeCloudOwner(epoch);
    expect(invoke.mock.calls).toEqual([
      ["market_connection_suspend_owner", {}],
      ["market_connection_sync_owner", { epoch: 42 }],
    ]);
  });

  it("hydrates with no authority to resume a suspended transition", async () => {
    invoke.mockResolvedValue(null);
    await synchronizeNativeCloudOwner();
    expect(invoke).toHaveBeenCalledWith("market_connection_sync_owner", {
      epoch: null,
    });
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid epoch argument %s before IPC",
    async (epoch) => {
      await expect(synchronizeNativeCloudOwner(epoch)).rejects.toThrow(
        "Invalid input"
      );
      expect(invoke).not.toHaveBeenCalled();
    }
  );

  it("uses endpoint/account equality without incorporating rotating credentials", () => {
    const raw = (
      accessToken: string,
      userId = "owner-a",
      supabaseUrl = "https://cloud.example/"
    ) =>
      JSON.stringify({ kind: "org2_cloud", userId, supabaseUrl, accessToken });
    expect(serializedCloudOwner(raw("old"))).toBe(
      serializedCloudOwner(raw("new"))
    );
    expect(serializedCloudOwner(raw("old"))).not.toBe(
      serializedCloudOwner(raw("old", "owner-b"))
    );
    expect(serializedCloudOwner(raw("old"))).not.toBe(
      serializedCloudOwner(raw("old", "owner-a", "https://other.example"))
    );
    expect(serializedCloudOwner("not-json")).toBeNull();
    expect(serializedCloudOwner("null")).toBeNull();
  });
});
