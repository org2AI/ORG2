import { expect, it, vi } from "vitest";

import { localizeBranchSwitchMessage } from "../branchSwitchMessages";

const t = vi.hoisted(() =>
  vi.fn((key: string, options: Record<string, string>) =>
    key.endsWith(".upstream_mismatch")
      ? "localized upstream"
      : key.endsWith(".restore_conflicts")
        ? `on ${options.branch}: ${options.detail}`
        : options.defaultValue
  )
);
vi.mock("@src/i18n", () => ({ default: { t } }));

it("localizes a known code instead of showing backend English", () => {
  expect(
    localizeBranchSwitchMessage({
      code: "upstream_mismatch",
      message: "A local branch with that name tracks a different upstream",
    })
  ).toBe("localized upstream");
});
it("passes branch and detail into parameterized messages", () => {
  expect(
    localizeBranchSwitchMessage(
      { code: "restore_conflicts", message: "x", detail: "conflict" },
      "develop"
    )
  ).toBe("on develop: conflict");
});
it("keys a Git operation block by its operation kind", () => {
  localizeBranchSwitchMessage({
    code: "operation_in_progress",
    message: "Finish the merge",
    detail: "merge",
  });
  expect(t).toHaveBeenLastCalledWith(
    "common:git.branchSwitch.messages.operation_merge",
    expect.objectContaining({ defaultValue: "Finish the merge" })
  );
});
it("shows raw Git errors and uncoded messages as sent", () => {
  t.mockClear();
  expect(
    localizeBranchSwitchMessage({ code: "git_error", message: "fatal: x" })
  ).toBe("fatal: x");
  expect(localizeBranchSwitchMessage({ message: "legacy" })).toBe("legacy");
  expect(t).not.toHaveBeenCalled();
});
