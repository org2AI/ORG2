import { useMemo } from "react";

import type {
  GitHubIssueComment,
  GitHubIssueTimelineItem,
  GitHubPrReview,
  GitHubReviewComment,
} from "@src/api/tauri/github";

import { groupIssueTimelineRows } from "../../IssuesContent/issueTimelineGrouping";
import type { TimelineEntry } from "./types";

const LABEL_TIMELINE_EVENTS = new Set(["labeled", "unlabeled"]);

/**
 * Inline review comments grouped by review id, and the conversation comments,
 * reviews, and label events merged into one chronological timeline.
 */
export function usePrConversationTimeline(
  conversation: GitHubIssueComment[],
  reviews: GitHubPrReview[],
  reviewComments: GitHubReviewComment[],
  timelineEvents: GitHubIssueTimelineItem[] = []
) {
  const commentsByReview = useMemo(() => {
    const map = new Map<number, GitHubReviewComment[]>();
    for (const comment of reviewComments) {
      const key = comment.pull_request_review_id;
      if (key == null) continue;
      const list = map.get(key) ?? [];
      list.push(comment);
      map.set(key, list);
    }
    return map;
  }, [reviewComments]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];
    for (const comment of conversation) {
      entries.push({ kind: "comment", at: comment.created_at, comment });
    }
    for (const review of reviews) {
      // Skip empty pending / commented reviews that carry neither body nor
      // inline comments — they add noise, not signal.
      const hasInline = (commentsByReview.get(review.id)?.length ?? 0) > 0;
      if (review.state === "COMMENTED" && !review.body.trim() && !hasInline) {
        continue;
      }
      entries.push({
        kind: "review",
        at: review.submitted_at ?? "",
        review,
      });
    }
    const labelEvents = timelineEvents.filter((item) =>
      LABEL_TIMELINE_EVENTS.has(item.event)
    );
    for (const row of groupIssueTimelineRows(labelEvents)) {
      const latest =
        row.kind === "labelGroup" ? row.items[row.items.length - 1] : row.item;
      entries.push({ kind: "labelEvent", at: latest.created_at ?? "", row });
    }
    entries.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    return entries;
  }, [conversation, reviews, commentsByReview, timelineEvents]);

  return { commentsByReview, timeline };
}
