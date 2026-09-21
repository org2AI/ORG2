/**
 * GitHub's merge box, section by section.
 *
 * The box under a pull request's conversation stacks independent sections —
 * deployments, checks, review, conflicts — over the merge button, each with
 * its own headline and detail line. The overall verdict and the review /
 * conflict / queue rows come from `summarizePullRequestMergeStatus`, the same
 * source the operations rail uses, so the two never disagree; this module
 * adds only what the rail does not show: the per-section headlines, the full
 * check list, and deployments. Everything is identifiers plus tones — the
 * renderer owns the wording.
 */
import type {
  GitHubChecksSummary,
  GitHubDeployment,
  GitHubDeploymentsSummary,
  GitHubPrReview,
} from "@src/api/tauri/github";
import {
  CI_CHECK_SECTION_ORDER,
  type CiCheckCounts,
  type CiCheckItem,
  type CiCheckState,
  countCheckStates,
  flattenChecks,
} from "@src/services/git/ciCheckState";

import {
  type PrMergeStatusRow,
  type PrMergeStatusSummary,
  type PrMergeStatusTone,
  summarizePullRequestMergeStatus,
} from "./prMergeStatus";

export type PrMergeBoxChecksHeadline =
  | "checksFailed"
  | "checksPending"
  | "checksPassed"
  | "checksSkipped";

export interface PrMergeBoxChecksSection {
  headline: PrMergeBoxChecksHeadline;
  tone: PrMergeStatusTone;
  counts: CiCheckCounts;
  /** Worst first, so a failure never needs scrolling to. */
  items: CiCheckItem[];
  /** GitHub folds the list away once there is nothing left to look at. */
  defaultExpanded: boolean;
}

export type PrCheckTimingKind =
  | "queued"
  | "started"
  | "successfulIn"
  | "failingAfter"
  | "skipped"
  | "completed";

export interface PrCheckTiming {
  kind: PrCheckTimingKind;
  /** Run time, for the verdicts that report one. */
  durationMs?: number;
  /** Start time, for a check that is still running. */
  startedAt?: string;
}

export type PrDeploymentState = "active" | "pending" | "failure" | "inactive";

export type PrMergeBoxDeploymentsHeadline =
  | "notDeployed"
  | "deployed"
  | "deploying"
  | "deployFailed"
  | "deployInactive";

export interface PrMergeBoxDeployment {
  deployment: GitHubDeployment;
  state: PrDeploymentState;
  tone: PrMergeStatusTone;
}

export interface PrMergeBoxDeploymentsSection {
  headline: PrMergeBoxDeploymentsHeadline;
  tone: PrMergeStatusTone;
  activeCount: number;
  deployments: PrMergeBoxDeployment[];
}

export interface PrMergeBoxModel {
  summary: PrMergeStatusSummary;
  /** Open or draft: the box still has conditions and a merge button to show. */
  mergeable: boolean;
  /** Null when the repository never deploys — GitHub shows no section then. */
  deployments: PrMergeBoxDeploymentsSection | null;
  /** Null when nothing reported on the head commit. */
  checks: PrMergeBoxChecksSection | null;
  /** Review, conflict and queue conditions, in GitHub's order. */
  conditions: PrMergeStatusRow[];
}

const CHECK_ROW_KINDS = new Set<PrMergeStatusRow["kind"]>([
  "checksPassed",
  "checksFailing",
  "checksRunning",
  "checksSkipped",
  "checksNone",
]);

function elapsedMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const elapsed = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

/** GitHub's per-check status line: "Successful in 2m", "Failing after 30s". */
export function describeCheckTiming(item: CiCheckItem): PrCheckTiming {
  if (item.state === "pending") {
    return item.startedAt
      ? { kind: "started", startedAt: item.startedAt }
      : { kind: "queued" };
  }
  if (item.state === "neutral") return { kind: "skipped" };
  const durationMs = elapsedMs(item.startedAt, item.completedAt);
  // Legacy commit statuses carry no timing — report the verdict alone.
  if (durationMs === null) return { kind: "completed" };
  return {
    kind: item.state === "success" ? "successfulIn" : "failingAfter",
    durationMs,
  };
}

function sortWorstFirst(items: CiCheckItem[]): CiCheckItem[] {
  const rank = new Map<CiCheckState, number>(
    CI_CHECK_SECTION_ORDER.map((state, index) => [state, index])
  );
  // `sort` is stable, so GitHub's own order survives inside each state.
  return [...items].sort(
    (left, right) => (rank.get(left.state) ?? 0) - (rank.get(right.state) ?? 0)
  );
}

export function summarizeMergeBoxChecks(
  checks: GitHubChecksSummary | null
): PrMergeBoxChecksSection | null {
  const items = flattenChecks(checks);
  if (items.length === 0) return null;
  const counts = countCheckStates(items);
  const headline: PrMergeBoxChecksHeadline =
    counts.failure > 0
      ? "checksFailed"
      : counts.pending > 0
        ? "checksPending"
        : counts.success > 0
          ? "checksPassed"
          : "checksSkipped";
  const tone: PrMergeStatusTone =
    headline === "checksFailed"
      ? "failure"
      : headline === "checksPending"
        ? "pending"
        : headline === "checksPassed"
          ? "success"
          : "neutral";
  return {
    headline,
    tone,
    counts,
    items: sortWorstFirst(items),
    defaultExpanded:
      headline === "checksFailed" || headline === "checksPending",
  };
}

export function deploymentState(state: string): PrDeploymentState {
  switch (state) {
    case "success":
      return "active";
    case "failure":
    case "error":
      return "failure";
    case "inactive":
      return "inactive";
    default:
      // queued | in_progress | pending, and anything GitHub adds later.
      return "pending";
  }
}

const DEPLOYMENT_TONES: Record<PrDeploymentState, PrMergeStatusTone> = {
  active: "success",
  pending: "pending",
  failure: "failure",
  inactive: "neutral",
};

export function summarizeMergeBoxDeployments(
  summary: GitHubDeploymentsSummary | null
): PrMergeBoxDeploymentsSection | null {
  if (!summary || !summary.repo_has_deployments) return null;
  const deployments = summary.deployments.map((deployment) => {
    const state = deploymentState(deployment.state);
    return { deployment, state, tone: DEPLOYMENT_TONES[state] };
  });
  const has = (state: PrDeploymentState) =>
    deployments.some((entry) => entry.state === state);
  const headline: PrMergeBoxDeploymentsHeadline =
    deployments.length === 0
      ? "notDeployed"
      : has("failure")
        ? "deployFailed"
        : has("pending")
          ? "deploying"
          : has("active")
            ? "deployed"
            : "deployInactive";
  const tone: PrMergeStatusTone =
    headline === "deployFailed"
      ? "failure"
      : headline === "deploying"
        ? "pending"
        : headline === "deployed"
          ? "success"
          : "neutral";
  return {
    headline,
    tone,
    activeCount: deployments.filter((entry) => entry.state === "active").length,
    deployments,
  };
}

export function buildPrMergeBox({
  checks,
  deployments,
  detail,
  fallbackStatus,
  reviews,
}: {
  checks: GitHubChecksSummary | null;
  deployments: GitHubDeploymentsSummary | null;
  detail: Record<string, unknown> | null;
  fallbackStatus: string;
  reviews: readonly GitHubPrReview[];
}): PrMergeBoxModel {
  const summary = summarizePullRequestMergeStatus({
    checks,
    detail,
    fallbackStatus,
    reviews,
  });
  const mergeable =
    summary.headline !== "merged" && summary.headline !== "closed";
  const conditions = summary.rows.filter(
    (row) => !CHECK_ROW_KINDS.has(row.kind)
  );
  // The rail folds a conflict into its headline; the box gives conflicts their
  // own section, so the row the summary skipped is restored here.
  if (summary.headline === "conflicts") {
    const queueIndex = conditions.findIndex(
      (row) => row.kind === "inMergeQueue" || row.kind === "autoMergeEnabled"
    );
    conditions.splice(queueIndex === -1 ? conditions.length : queueIndex, 0, {
      kind: "hasConflicts",
      tone: "failure",
    });
  }
  return {
    summary,
    mergeable,
    deployments: summarizeMergeBoxDeployments(deployments),
    // A merged or closed pull request has no pending verdict to itemize.
    checks: mergeable ? summarizeMergeBoxChecks(checks) : null,
    conditions,
  };
}
