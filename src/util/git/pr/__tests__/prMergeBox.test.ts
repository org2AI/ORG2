import { describe, expect, it } from "vitest";

import type {
  GitHubChecksSummary,
  GitHubDeployment,
  GitHubDeploymentsSummary,
} from "@src/api/tauri/github";
import { flattenChecks } from "@src/services/git/ciCheckState";

import {
  buildPrMergeBox,
  describeCheckTiming,
  summarizeMergeBoxChecks,
  summarizeMergeBoxDeployments,
} from "../prMergeBox";

type CheckRun = GitHubChecksSummary["check_runs"][number];

function checkRun(
  name: string,
  status: string,
  conclusion: string | null,
  timing: Partial<Pick<CheckRun, "started_at" | "completed_at">> = {}
): CheckRun {
  return {
    id: name.length * 31 + name.charCodeAt(0),
    name,
    status,
    conclusion,
    started_at: "2026-09-01T10:00:00Z",
    completed_at: conclusion ? "2026-09-01T10:02:30Z" : null,
    details_url: `https://github.com/org/repo/runs/${name}`,
    output_title: null,
    app_name: "CI",
    ...timing,
  };
}

function checksOf(runs: CheckRun[]): GitHubChecksSummary {
  return { sha: "head", check_runs: runs, statuses: [], state: "pending" };
}

function deployment(environment: string, state: string): GitHubDeployment {
  return {
    id: environment.length * 17 + state.length,
    environment,
    state,
    description: null,
    environment_url: `https://${environment}.example.com`,
    log_url: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:01:00Z",
  };
}

function deploymentsOf(
  deployments: GitHubDeployment[],
  repoHasDeployments = true
): GitHubDeploymentsSummary {
  return {
    git_ref: "feat/box",
    repo_has_deployments: repoHasDeployments,
    deployments,
  };
}

const OPEN_CLEAN = {
  state: "open",
  mergeable: true,
  mergeable_state: "clean",
};

describe("merge box checks section", () => {
  it("has no section when nothing reported on the head commit", () => {
    expect(summarizeMergeBoxChecks(null)).toBeNull();
    expect(summarizeMergeBoxChecks(checksOf([]))).toBeNull();
  });

  it("says checks haven't completed while any is still running, and opens the list", () => {
    const section = summarizeMergeBoxChecks(
      checksOf([
        checkRun("lint", "completed", "success"),
        checkRun("test", "in_progress", null),
      ])
    );
    expect(section).toMatchObject({
      headline: "checksPending",
      tone: "pending",
      defaultExpanded: true,
      counts: { total: 2, pending: 1, success: 1 },
    });
  });

  it("lets one failure outrank running checks and lists it first", () => {
    const section = summarizeMergeBoxChecks(
      checksOf([
        checkRun("lint", "completed", "success"),
        checkRun("test", "in_progress", null),
        checkRun("build", "completed", "failure"),
      ])
    );
    expect(section?.headline).toBe("checksFailed");
    expect(section?.items.map((item) => item.name)).toEqual([
      "build",
      "test",
      "lint",
    ]);
  });

  it("folds the list away once every check has passed", () => {
    const section = summarizeMergeBoxChecks(
      checksOf([
        checkRun("lint", "completed", "success"),
        checkRun("docs", "completed", "skipped"),
      ])
    );
    expect(section).toMatchObject({
      headline: "checksPassed",
      tone: "success",
      defaultExpanded: false,
    });
  });

  it("reports an all-skipped head as skipped rather than passed", () => {
    expect(
      summarizeMergeBoxChecks(
        checksOf([checkRun("docs", "completed", "skipped")])
      )?.headline
    ).toBe("checksSkipped");
  });
});

describe("merge box check status line", () => {
  const timingOf = (run: CheckRun) =>
    describeCheckTiming(flattenChecks(checksOf([run]))[0]);

  it("names the start of a running check and the queue for one not started", () => {
    expect(timingOf(checkRun("test", "in_progress", null))).toEqual({
      kind: "started",
      startedAt: "2026-09-01T10:00:00Z",
    });
    expect(
      timingOf(checkRun("test", "queued", null, { started_at: null }))
    ).toEqual({ kind: "queued" });
  });

  it("reports how long a finished check ran", () => {
    expect(timingOf(checkRun("test", "completed", "success"))).toEqual({
      kind: "successfulIn",
      durationMs: 150_000,
    });
    expect(timingOf(checkRun("test", "completed", "failure"))).toEqual({
      kind: "failingAfter",
      durationMs: 150_000,
    });
    expect(timingOf(checkRun("test", "completed", "skipped")).kind).toBe(
      "skipped"
    );
  });

  it("reports only the verdict for a legacy status without timing", () => {
    const [status] = flattenChecks({
      sha: "head",
      check_runs: [],
      statuses: [
        {
          context: "ci/legacy",
          state: "success",
          description: null,
          target_url: null,
          avatar_url: null,
        },
      ],
      state: "success",
    });
    expect(describeCheckTiming(status)).toEqual({ kind: "completed" });
  });
});

describe("merge box deployments section", () => {
  it("is omitted for a repository that never deploys, or an unread answer", () => {
    expect(summarizeMergeBoxDeployments(null)).toBeNull();
    expect(summarizeMergeBoxDeployments(deploymentsOf([], false))).toBeNull();
  });

  it("says the branch has not been deployed when only other branches were", () => {
    expect(summarizeMergeBoxDeployments(deploymentsOf([]))).toMatchObject({
      headline: "notDeployed",
      tone: "neutral",
      activeCount: 0,
    });
  });

  it("counts active environments of a deployed branch", () => {
    expect(
      summarizeMergeBoxDeployments(
        deploymentsOf([
          deployment("production", "success"),
          deployment("preview", "success"),
          deployment("staging", "inactive"),
        ])
      )
    ).toMatchObject({ headline: "deployed", tone: "success", activeCount: 2 });
  });

  it("ranks a failed deployment over a running one over an active one", () => {
    const active = deployment("production", "success");
    expect(
      summarizeMergeBoxDeployments(
        deploymentsOf([active, deployment("preview", "in_progress")])
      )?.headline
    ).toBe("deploying");
    expect(
      summarizeMergeBoxDeployments(
        deploymentsOf([
          active,
          deployment("preview", "queued"),
          deployment("staging", "error"),
        ])
      )?.headline
    ).toBe("deployFailed");
    expect(
      summarizeMergeBoxDeployments(
        deploymentsOf([deployment("staging", "inactive")])
      )?.headline
    ).toBe("deployInactive");
  });
});

describe("merge box model", () => {
  it("keeps checks out of the condition list and conflicts in it", () => {
    const box = buildPrMergeBox({
      checks: checksOf([checkRun("test", "in_progress", null)]),
      deployments: deploymentsOf([]),
      detail: { ...OPEN_CLEAN, review_decision: "REVIEW_REQUIRED" },
      fallbackStatus: "open",
      reviews: [],
    });
    expect(box.mergeable).toBe(true);
    expect(box.checks?.headline).toBe("checksPending");
    expect(box.deployments?.headline).toBe("notDeployed");
    expect(box.conditions.map((row) => row.kind)).toEqual([
      "reviewRequired",
      "noConflicts",
    ]);
  });

  it("gives conflicts their own section even though the rail folds them into its headline", () => {
    const box = buildPrMergeBox({
      checks: null,
      deployments: null,
      detail: { state: "open", mergeable: false, mergeable_state: "dirty" },
      fallbackStatus: "open",
      reviews: [],
    });
    expect(box.summary.headline).toBe("conflicts");
    expect(box.conditions).toEqual([{ kind: "hasConflicts", tone: "failure" }]);
  });

  it("itemizes nothing once the pull request is merged", () => {
    const box = buildPrMergeBox({
      checks: checksOf([checkRun("test", "completed", "success")]),
      deployments: null,
      detail: { state: "closed", merged: true },
      fallbackStatus: "merged",
      reviews: [],
    });
    expect(box.mergeable).toBe(false);
    expect(box.checks).toBeNull();
    expect(box.conditions).toEqual([]);
  });
});
