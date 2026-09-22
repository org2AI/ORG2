import type { GitHubIssueComment, GitHubPrReview } from "@src/api/tauri/github";

import type { useWorkstationPrDetail } from "../../../hooks/useWorkstationPrDetail";
import type { IssueTimelineRow } from "../../IssuesContent/issueTimelineGrouping";

/** Mutations, picker candidates and pending flags for the mounted PR. */
export type WorkstationPrDetailController = ReturnType<
  typeof useWorkstationPrDetail
>;

// ── Merged timeline ──────────────────────────────────────────────────────────

export type TimelineEntry =
  | { kind: "comment"; at: string; comment: GitHubIssueComment }
  | { kind: "review"; at: string; review: GitHubPrReview }
  /** A `labeled`/`unlabeled` entry (or grouped run) from the PR's
   * GitHub issue-timeline, interleaved with its comments and reviews. */
  | { kind: "labelEvent"; at: string; row: IssueTimelineRow };
