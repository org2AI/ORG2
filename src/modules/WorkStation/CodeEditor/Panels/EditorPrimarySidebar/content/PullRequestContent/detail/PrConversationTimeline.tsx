import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";

import type { GitHubReviewComment } from "@src/api/tauri/github";
import PersonAvatar from "@src/components/PersonAvatar";
import {
  ConnectedTimelineItem,
  MarkdownContent,
  TimelineCard,
  TimelineCardHeader,
  TimelineLoadingSkeleton,
  TimelineStack,
} from "@src/features/GitHubWork/ActivityTimeline";
import { projectMarkdownSessionReferences } from "@src/features/Org2Cloud/markdown/sessionReferenceProjection";
import {
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  FileDiffIcon,
  HugeiconsIcon,
} from "@src/icons";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import {
  IssueTimelineEventRow,
  IssueTimelineLabelGroupRow,
} from "../../IssuesContent/IssueTimelineEvent";
import type { TimelineEntry } from "./types";

interface PrAuthor {
  login: string;
  avatarUrl: string;
}

function readAuthor(detail: Record<string, unknown> | null): PrAuthor {
  const user = (detail?.user as Record<string, unknown> | undefined) ?? {};
  return {
    login: typeof user.login === "string" ? user.login : "",
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : "",
  };
}

function readString(
  detail: Record<string, unknown> | null,
  key: string
): string {
  const value = detail?.[key];
  return typeof value === "string" ? value : "";
}

// ── Review presentation ──────────────────────────────────────────────────────

function reviewVerb(
  state: string,
  t: TFunction
): { label: string; icon: React.ReactNode } {
  switch (state) {
    case "APPROVED":
      return {
        label: t("git.pr.activity.approved"),
        icon: (
          <HugeiconsIcon
            icon={CheckmarkCircle01Icon}
            data-icon="check-circle-2"
            size={14}
            strokeWidth={1.9}
            className="text-success-6"
          />
        ),
      };
    case "CHANGES_REQUESTED":
      return {
        label: t("git.pr.activity.changesRequested"),
        icon: (
          <HugeiconsIcon
            icon={CancelCircleIcon}
            data-icon="xcircle"
            size={14}
            strokeWidth={1.9}
            className="text-danger-6"
          />
        ),
      };
    case "DISMISSED":
      return {
        label: t("git.pr.activity.reviewDismissed"),
        icon: (
          <HugeiconsIcon
            icon={FileDiffIcon}
            data-icon="file-diff"
            size={14}
            strokeWidth={1.9}
            className="text-text-3"
          />
        ),
      };
    default:
      return {
        label: t("git.pr.activity.reviewed"),
        icon: (
          <HugeiconsIcon
            icon={FileDiffIcon}
            data-icon="file-diff"
            size={14}
            strokeWidth={1.9}
            className="text-text-3"
          />
        ),
      };
  }
}

function ReviewCommentSummary({
  comments,
}: {
  comments: GitHubReviewComment[];
}): React.ReactNode {
  if (comments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="rounded-lg border border-border-1 bg-fill-1 px-2.5 py-1.5"
        >
          <div className="truncate text-[11px] font-medium text-text-2">
            {comment.path}
            {comment.line != null ? `:${comment.line}` : ""}
          </div>
          <div className="mt-0.5 line-clamp-3 text-[12px] text-text-2">
            {comment.body}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PrConversationTimelineProps {
  detail: Record<string, unknown> | null;
  identity: PrIdentity;
  timeline: TimelineEntry[];
  commentsByReview: Map<number, GitHubReviewComment[]>;
  loading: boolean;
}

/** The PR description card followed by the merged comment/review timeline. */
export function PrConversationTimeline({
  detail,
  identity,
  timeline,
  commentsByReview,
  loading,
}: PrConversationTimelineProps): React.ReactNode {
  const { t } = useTranslation("common");
  const author = readAuthor(detail);
  const body = readString(detail, "body");
  const createdAt = readString(detail, "created_at");

  const lastIndex = timeline.length; // description card is index -1 conceptually

  return (
    <TimelineStack>
      {/* PR description */}
      <ConnectedTimelineItem
        isLast={timeline.length === 0 && !loading}
        trailLabel={identity.title}
      >
        <TimelineCard
          copyBody={body}
          header={
            <TimelineCardHeader
              avatar={
                <PersonAvatar
                  size={18}
                  name={author.login || identity.title}
                  src={author.avatarUrl}
                />
              }
              actor={author.login || identity.title}
              action={t("git.pr.activity.opened")}
              timestamp={createdAt}
            />
          }
        >
          <MarkdownContent
            body={body}
            emptyText={t("git.pr.noDescription")}
            fadeFrom="from-chat-pane"
          />
        </TimelineCard>
      </ConnectedTimelineItem>

      {loading && timeline.length === 0 ? (
        <ConnectedTimelineItem isLast>
          <TimelineLoadingSkeleton label={t("git.pr.loadingConversation")} />
        </ConnectedTimelineItem>
      ) : (
        timeline.map((entry, index) => {
          const isLast = index === lastIndex - 1;
          if (entry.kind === "comment") {
            const { comment } = entry;
            const isSessionAttachment = projectMarkdownSessionReferences(
              comment.body
            ).referenceOnly;
            return (
              <ConnectedTimelineItem
                key={`c-${comment.id}`}
                isLast={isLast}
                trailLabel={`${comment.user.login}: ${comment.body}`}
              >
                <TimelineCard
                  copyBody={comment.body}
                  header={
                    <TimelineCardHeader
                      avatar={
                        <PersonAvatar
                          size={18}
                          name={comment.user.login}
                          src={comment.user.avatar_url}
                        />
                      }
                      actor={comment.user.login}
                      action={
                        isSessionAttachment
                          ? t("git.pr.activity.appendedSession")
                          : t("git.pr.activity.commented")
                      }
                      timestamp={comment.created_at}
                    />
                  }
                >
                  <MarkdownContent
                    body={comment.body}
                    fadeFrom="from-chat-pane"
                  />
                </TimelineCard>
              </ConnectedTimelineItem>
            );
          }
          if (entry.kind === "labelEvent") {
            const { row } = entry;
            if (row.kind === "labelGroup") {
              const latest = row.items[row.items.length - 1];
              return (
                <ConnectedTimelineItem
                  key={`lg-${row.event}-${latest.id ?? latest.created_at ?? index}`}
                  isLast={isLast}
                  trailLabel={`${row.actor?.login ?? "GitHub"} · ${row.event}`}
                >
                  <IssueTimelineLabelGroupRow
                    event={row.event}
                    actor={row.actor}
                    items={row.items}
                  />
                </ConnectedTimelineItem>
              );
            }
            const { item } = row;
            return (
              <ConnectedTimelineItem
                key={`le-${item.id ?? item.created_at ?? index}`}
                isLast={isLast}
                trailLabel={`${item.actor?.login ?? "GitHub"} · ${item.event}`}
              >
                <IssueTimelineEventRow item={item} />
              </ConnectedTimelineItem>
            );
          }
          const { review } = entry;
          const verb = reviewVerb(review.state, t);
          const inline = commentsByReview.get(review.id) ?? [];
          return (
            <ConnectedTimelineItem
              key={`r-${review.id}`}
              isLast={isLast}
              trailLabel={`${review.user.login}: ${verb.label}`}
            >
              <TimelineCard
                copyBody={review.body}
                header={
                  <TimelineCardHeader
                    avatar={
                      <PersonAvatar
                        size={18}
                        name={review.user.login}
                        src={review.user.avatar_url}
                      />
                    }
                    indicator={<span className="shrink-0">{verb.icon}</span>}
                    actor={review.user.login}
                    action={verb.label}
                    timestamp={review.submitted_at}
                  />
                }
              >
                {review.body.trim() ? (
                  <MarkdownContent
                    body={review.body}
                    fadeFrom="from-chat-pane"
                  />
                ) : (
                  <div className="text-[12px] text-text-3 italic">
                    {t("git.pr.reviewNoBody")}
                  </div>
                )}
                <ReviewCommentSummary comments={inline} />
              </TimelineCard>
            </ConnectedTimelineItem>
          );
        })
      )}
    </TimelineStack>
  );
}
