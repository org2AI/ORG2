import { beforeEach, describe, expect, it, vi } from "vitest";

import { runGuardedCheckout } from "../guardedCheckout";

const api = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn() }));
vi.mock("@src/api/http/git/branchSwitch", () => ({ branchSwitchApi: api }));
const p = {
  current_branch: "main",
  target_branch: "develop",
  fingerprint: "v1",
  changed_files: [],
  default_strategy: "leave",
  same_branch: false,
  blocked: null,
};
const params = { repoId: "repo", ref: "develop", onConflict: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  api.prepare.mockResolvedValue(p);
});
describe("checkout recovery", () => {
  it("re-reads HEAD after a lost execute response without retrying the mutation", async () => {
    api.prepare
      .mockResolvedValueOnce(p)
      .mockResolvedValueOnce({ ...p, current_branch: "develop" });
    api.execute.mockRejectedValue(new Error("connection lost"));
    const r = await runGuardedCheckout(params);
    expect(r).toMatchObject({ success: false, currentBranch: "develop" });
    expect(api.execute).toHaveBeenCalledOnce();
  });
  it("does not invent a branch when recovery read also fails", async () => {
    api.prepare
      .mockResolvedValueOnce(p)
      .mockRejectedValue(new Error("offline"));
    api.execute.mockRejectedValue(new Error("offline"));
    expect(await runGuardedCheckout(params)).toMatchObject({
      success: false,
      currentBranch: undefined,
    });
  });
  it("reports partial checkout from the backend without rolling back the display", async () => {
    api.execute.mockResolvedValue({
      outcome: "recovery_required",
      current_branch: "develop",
      message: "Saved",
      snapshot_id: "id",
      conflicts: [],
    });
    const complete = vi.fn();
    expect(
      await runGuardedCheckout({ ...params, onComplete: complete })
    ).toMatchObject({
      success: false,
      currentBranch: "develop",
      blocked: true,
    });
    expect(complete).toHaveBeenCalledOnce();
  });
});
