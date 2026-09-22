import type { MemberEntry } from "@src/api/http/project";
import type { TeamInboxMention } from "@src/features/Org2Cloud/teamInboxMentionsClient";

import { dedupeTeamInboxItems, sortTeamInboxItems } from "../domain";
import type { TeamInboxIssue, TeamInboxItem } from "../domain";
import {
  MAX_CACHED_TEAM_INBOX_ITEMS,
  type TeamInboxCoordinatorScope,
} from "./runtime";

export function errorDetail(errors: readonly unknown[]): string | undefined {
  const messages = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .filter(Boolean);
  return messages.length > 0 ? messages.join(" · ") : undefined;
}

export function issueForFailures(
  failures: readonly unknown[],
  requestedSourceCount: number
): TeamInboxIssue | null {
  if (failures.length === 0) return null;
  return {
    code:
      failures.length >= requestedSourceCount ? "load_failed" : "partial_load",
    detail: errorDetail(failures),
  };
}

export function mergeIssues(
  primary: TeamInboxIssue | null,
  secondary: TeamInboxIssue | null | undefined
): TeamInboxIssue | null {
  if (!primary) return secondary ?? null;
  if (!secondary) return primary;
  return {
    code:
      primary.code === "load_failed" || secondary.code === "load_failed"
        ? "load_failed"
        : primary.code === "identity_unresolved" ||
            secondary.code === "identity_unresolved"
          ? "identity_unresolved"
          : "partial_load",
    detail: errorDetail([primary.detail, secondary.detail].filter(Boolean)),
  };
}

export function prerequisiteIssueForScope(
  scope: TeamInboxCoordinatorScope
): TeamInboxIssue | null {
  const identityIssue =
    scope.viewerMemberIds.length === 0 && scope.members.length > 0
      ? ({ code: "identity_unresolved" } as const)
      : null;
  return mergeIssues(identityIssue, scope.prerequisiteIssue);
}

export function sameIssue(
  left: TeamInboxIssue | null,
  right: TeamInboxIssue | null
): boolean {
  return left?.code === right?.code && left?.detail === right?.detail;
}

export function mapMentionsToItems(
  mentions: readonly TeamInboxMention[],
  activeCloudOrgId: string
): TeamInboxItem[] {
  return mentions.map((mention) => ({
    id: `cloud-comment:${activeCloudOrgId}:${mention.comment.id}`,
    kind: "comment_mention" as const,
    source: "cloud" as const,
    occurredAt: mention.createdAt,
    readAt: mention.readAt,
    actor: {
      id: mention.author.userId,
      displayName: mention.author.displayName ?? mention.author.userId,
    },
    target: {
      kind: "session_comment" as const,
      orgId: activeCloudOrgId,
      sessionId: mention.session.id,
      sessionTitle: mention.session.title ?? mention.session.id,
      commentId: mention.comment.id,
      threadId: mention.comment.parentId ?? mention.comment.id,
      anchor: mention.comment.id,
    },
    payload: {
      commentBody: mention.body,
      commentCount: mention.commentCount,
      threadCommentCount: mention.threadCount,
    },
  }));
}

export function resolveTeamInboxMemberNames(
  items: readonly TeamInboxItem[],
  members: readonly MemberEntry[]
): TeamInboxItem[] {
  if (members.length === 0) return [...items];
  const nameById = new Map(members.map((member) => [member.id, member.name]));
  return items.map((item) => {
    const actorName = nameById.get(item.actor.id);
    const nextActor =
      actorName && actorName !== item.actor.displayName
        ? { ...item.actor, displayName: actorName }
        : item.actor;
    if (item.kind === "comment_mention") {
      return nextActor === item.actor ? item : { ...item, actor: nextActor };
    }
    if (item.kind === "assigned_work_item") {
      const assigneeName = nameById.get(item.payload.assigneeMemberId);
      if (
        (!assigneeName || assigneeName === item.payload.assigneeName) &&
        nextActor === item.actor
      ) {
        return item;
      }
      return {
        ...item,
        actor: nextActor,
        payload: {
          ...item.payload,
          ...(assigneeName ? { assigneeName } : {}),
        },
      };
    }
    const recipientName = nameById.get(item.payload.recipientMemberId);
    if (
      (!recipientName || recipientName === item.payload.recipientName) &&
      nextActor === item.actor
    ) {
      return item;
    }
    return {
      ...item,
      actor: nextActor,
      payload: {
        ...item.payload,
        ...(recipientName ? { recipientName } : {}),
      },
    };
  });
}

export function boundedItems(items: readonly TeamInboxItem[]): TeamInboxItem[] {
  return sortTeamInboxItems(dedupeTeamInboxItems(items)).slice(
    0,
    MAX_CACHED_TEAM_INBOX_ITEMS
  );
}
