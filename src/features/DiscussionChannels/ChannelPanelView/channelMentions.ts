import type { SubmitOverrideInput } from "@src/engines/ChatPanel/hooks/useInputArea/types";
import {
  type TeamChatMentionMember,
  hasUnsupportedTeamChatAudiencePill,
  isTeamChatMentionAudienceWithinLimit,
  resolveTeamChatAudienceTargets,
  resolveTeamChatMentionedUserIds,
} from "@src/features/Org2Cloud/SessionConversation/teamChatMentions";

/** Resolve only identities that can read this channel; never drop a pill silently. */
export function resolveChannelMentionedUserIds(
  input: SubmitOverrideInput,
  members: readonly TeamChatMentionMember[] | null,
  viewerUserId: string | null
): string[] {
  if (hasUnsupportedTeamChatAudiencePill(input.composerSnapshot)) {
    throw new Error("Channel messages cannot address agents");
  }
  const hasMention =
    /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_-]/u.test(input.displayText) ||
    input.composerSnapshot?.parts.some(
      (part) => part.kind === "pill" && part.attrs.iconType === "member"
    );
  if (!hasMention) return [];
  if (!members || !viewerUserId)
    throw new Error("Channel audience unavailable");
  const targets = resolveTeamChatAudienceTargets(
    input.displayText,
    members,
    input.composerSnapshot
  );
  const memberIds = new Set(members.map((member) => member.userId));
  if (
    targets.some(
      (target) => target.kind === "member" && !memberIds.has(target.id)
    )
  ) {
    throw new Error("Channel audience changed");
  }
  const ids = resolveTeamChatMentionedUserIds(
    input.displayText,
    members,
    input.composerSnapshot,
    viewerUserId
  );
  if (!isTeamChatMentionAudienceWithinLimit(ids)) {
    throw new Error("Channel audience exceeds the recipient limit");
  }
  return ids;
}
