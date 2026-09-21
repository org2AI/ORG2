import { beforeEach, describe, expect, it, vi } from "vitest";

import { runGuardedCheckout } from "../guardedCheckout";

const api = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn() }));
vi.mock("@src/api/http/git/branchSwitch", () => ({ branchSwitchApi: api }));
const base = { repoId: "repo", repoPath: "/repo", ref: "develop" };
const prepared = {
  current_branch: "main",
  target_branch: "develop",
  fingerprint: "v1",
  changed_files: [],
  default_strategy: "leave",
  same_branch: false,
  blocked: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  api.prepare.mockResolvedValue({ ...prepared });
  api.execute.mockResolvedValue({
    outcome: "switched",
    current_branch: "develop",
    message: "",
    snapshot_id: null,
    conflicts: [],
  });
});
describe("guarded checkout", () => {
  it("switches clean state without prompting", async () => {
    const choose = vi.fn();
    expect(
      await runGuardedCheckout({ ...base, onConflict: choose })
    ).toMatchObject({
      success: true,
      currentBranch: "develop",
      outcome: "checked-out",
    });
    expect(choose).not.toHaveBeenCalled();
    expect(api.execute).toHaveBeenCalledWith(
      { repoId: "repo", repoPath: "/repo" },
      { branch: "develop", create: undefined, start_point: undefined },
      "v1",
      "leave"
    );
  });
  it("asks before any mutation for compatible dirty edits", async () => {
    api.prepare.mockResolvedValue({ ...prepared, changed_files: ["file"] });
    const choose = vi.fn(async () => {
      expect(api.execute).not.toHaveBeenCalled();
      return "bring" as const;
    });
    expect(
      await runGuardedCheckout({ ...base, onConflict: choose })
    ).toMatchObject({ success: true, outcome: "brought" });
    expect(choose).toHaveBeenCalledOnce();
  });
  it("cancel performs zero writes", async () => {
    api.prepare.mockResolvedValue({ ...prepared, changed_files: ["file"] });
    expect(
      await runGuardedCheckout({ ...base, onConflict: async () => "cancel" })
    ).toMatchObject({ outcome: "cancelled", currentBranch: "main" });
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("blocks worktree occupancy before the choice", async () => {
    api.prepare.mockResolvedValue({
      ...prepared,
      blocked: {
        code: "worktree_branch_in_use",
        message: "Busy",
        worktree_path: "/other",
      },
    });
    const choose = vi.fn(),
      blocked = vi.fn();
    await runGuardedCheckout({
      ...base,
      onConflict: choose,
      onBlocked: blocked,
    });
    expect(blocked).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: "/other" })
    );
    expect(choose).not.toHaveBeenCalled();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("reports the actual destination when apply conflicts", async () => {
    api.execute.mockResolvedValue({
      outcome: "switched_with_conflicts",
      current_branch: "develop",
      message: "Resolve",
      snapshot_id: "id",
      conflicts: ["file"],
    });
    expect(
      await runGuardedCheckout({ ...base, onConflict: async () => "bring" })
    ).toMatchObject({
      success: true,
      outcome: "conflicts",
      currentBranch: "develop",
    });
  });
  it("preserves resolved local name for a remote checkout", async () => {
    expect(
      await runGuardedCheckout({
        ...base,
        ref: "origin/develop",
        onConflict: vi.fn(),
      })
    ).toMatchObject({ currentBranch: "develop" });
  });
  it("passes new-branch base and backend default into execute", async () => {
    api.prepare.mockResolvedValue({ ...prepared, default_strategy: "bring" });
    await runGuardedCheckout({
      ...base,
      create: true,
      startPoint: "main",
      onConflict: vi.fn(),
    });
    expect(api.execute).toHaveBeenCalledWith(
      expect.anything(),
      { branch: "develop", create: true, start_point: "main" },
      "v1",
      "bring"
    );
  });
  it("deduplicates concurrent requests and releases on cancel", async () => {
    let resolve!: (v: "cancel") => void;
    api.prepare.mockResolvedValue({ ...prepared, changed_files: ["file"] });
    const first = runGuardedCheckout({
      ...base,
      onConflict: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    expect(
      await runGuardedCheckout({ ...base, onConflict: vi.fn() })
    ).toMatchObject({ outcome: "cancelled" });
    resolve("cancel");
    await first;
    await runGuardedCheckout({ ...base, onConflict: async () => "cancel" });
    expect(api.prepare).toHaveBeenCalledTimes(2);
  });
  it("honors both editor barriers", async () => {
    await runGuardedCheckout({
      ...base,
      beforePrepare: async () => false,
      onConflict: vi.fn(),
    });
    expect(api.prepare).not.toHaveBeenCalled();
    await runGuardedCheckout({
      ...base,
      beforeExecute: async () => false,
      onConflict: vi.fn(),
    });
    expect(api.execute).not.toHaveBeenCalled();
  });
});
