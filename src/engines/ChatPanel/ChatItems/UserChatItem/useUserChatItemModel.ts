import { useMemo } from "react";

import type { OptimizedChatItem } from "@src/engines/ChatPanel/ChatHistory/chatItemPipeline/types";
import { useSessionCommentsContext } from "@src/features/Org2Cloud/SessionComments/SessionCommentsContext";
import { discussionPayloadOf } from "@src/features/Org2Cloud/SessionConversation/discussionEvents";
import { formatSmartDateTime } from "@src/util/data/formatters/date";

import type { UserMessageMention } from "../../ChatHistory/components/UserMessageContent";
import { stripExpandedPillContent } from "../../InputArea/utils/pillContentParser";
import { useConversationSenderResolution } from "../ConversationSenderMetadataContext";
import { useParentAgentSender } from "../ParentAgentSenderContext";
import { normalizeUserMessageText } from "../normalizeUserMessageText";
import { describeModelLabel } from "../rawPromptModelLabel";
import { resolveRawUserPrompt } from "../rawUserPrompt";
import { useUserMessageDeliveryActions } from "../useUserMessageDeliveryActions";

const AGENT_ORG_INBOX_TRANSCRIPT_PREFIX = "Acknowledged inbox batch";

interface UseUserChatItemModelArgs {
  chatItem: OptimizedChatItem;
  modelId?: string | null;
  onEditSubmit?: (newText: string, imageDataUrls?: string[]) => void;
}

/** Derives the message text, attribution, and delivery state of a user turn. */
export function useUserChatItemModel({
  chatItem,
  modelId,
  onEditSubmit,
}: UseUserChatItemModelArgs) {
  const event = chatItem.event;
  const messageTimestamp = event?.createdAt ?? null;
  const timestampLabel = useMemo(
    () => (messageTimestamp ? formatSmartDateTime(messageTimestamp) : null),
    [messageTimestamp]
  );
  const modelLabel = useMemo(() => describeModelLabel(modelId), [modelId]);
  const senderResolution = useConversationSenderResolution(event);
  // Who wrote this turn. In a session an agent started, a `user` turn is the
  // parent's dispatch rather than the reader's own message, so the row is
  // attributed to the parent session — same identity icon the header shows.
  // Resolved once for the whole chat; see ParentAgentSenderContext.
  const parentAgentSender = useParentAgentSender();
  // Team chat @-mentions: the comment carries account ids; names come from
  // the org roster so the `@name` text renders as a member pill.
  const comments = useSessionCommentsContext();
  const mentionableMembers = comments?.mentionableMembers;
  const discussionPayload = event ? discussionPayloadOf(event) : null;
  const mentionedUserIds = discussionPayload?.mentionedUserIds;
  const mentions: UserMessageMention[] | undefined = (() => {
    if (!mentionedUserIds?.length) return undefined;
    const resolved: UserMessageMention[] = [];
    for (const userId of mentionedUserIds) {
      const member = mentionableMembers?.find(
        (candidate) => candidate.userId === userId
      );
      const displayName = member?.displayName?.trim();
      if (displayName) resolved.push({ userId, displayName });
    }
    return resolved.length > 0 ? resolved : undefined;
  })();
  const editedText = event?.displayText
    ? stripExpandedPillContent(String(event.displayText))
    : "";

  const activityResult = useMemo(() => {
    if (event) {
      return { result: event.result };
    }
    return undefined;
  }, [event]);

  const activityImages = useMemo((): string[] | undefined => {
    const result = activityResult?.result as
      | Record<string, unknown>
      | undefined;
    const images = result?.images;
    if (!Array.isArray(images) || images.length === 0) return undefined;
    return images.filter((image): image is string => typeof image === "string");
  }, [activityResult]);
  const deliveryStatus = (() => {
    const raw = activityResult?.result?.deliveryStatus;
    if (raw === "pending" || raw === "sent" || raw === "failed") {
      return raw;
    }
    if (event?.displayStatus === "pending") return "pending";
    if (event?.displayStatus === "failed") return "failed";
    return null;
  })();
  const deliveryError =
    typeof activityResult?.result?.deliveryError === "string"
      ? activityResult.result.deliveryError
      : null;
  const deliveryActions = useUserMessageDeliveryActions({
    event,
    deliveryStatus,
  });

  const fullContent = useMemo(() => {
    // When display_text is present on the event it is the pill-format string
    // that the user originally typed (e.g. "create-rule [skill:/create-rule]").
    // Prefer it unconditionally — falling back to message.content would show the
    // expanded YAML/raw text instead of the pill badge.
    if (editedText) return normalizeUserMessageText(editedText, activityImages);

    // Legacy path: no display_text stored (old messages). Use message.content
    // stripped of any auto-expanded pill block.
    const message = activityResult?.result?.message as
      | { content?: string }
      | undefined;
    const content = message?.content;
    if (typeof content === "string") {
      return normalizeUserMessageText(
        stripExpandedPillContent(content),
        activityImages
      );
    }
    return "";
  }, [activityImages, activityResult, editedText]);

  const isAgentOrgInboxTranscript = Boolean(
    event?.args?.agentOrgInboxTranscript === true ||
    (activityResult?.result as Record<string, unknown> | undefined)
      ?.agentOrgInboxTranscript === true ||
    fullContent.startsWith(AGENT_ORG_INBOX_TRANSCRIPT_PREFIX)
  );

  // Extract images from activity result for display in chat history.
  const messageImages = isAgentOrgInboxTranscript ? undefined : activityImages;
  const retryDelivery = discussionPayload
    ? deliveryActions.retry
    : (deliveryActions.retry ??
      (onEditSubmit
        ? () => onEditSubmit(editedText || fullContent, messageImages)
        : null));

  // The wire prompt behind this bubble. `fullContent` is a rendering of it
  // (pills as badges, expansion block stripped, envelope normalized), so the
  // raw string is only reachable through the event itself.
  const rawPrompt = useMemo(() => resolveRawUserPrompt(event), [event]);

  const cachedFiles: string[] = isAgentOrgInboxTranscript
    ? []
    : (event?.args?.cached_files as string[]) || [];

  return {
    event,
    messageTimestamp,
    timestampLabel,
    modelLabel,
    senderResolution,
    parentAgentSender,
    mentions,
    editedText,
    deliveryStatus,
    deliveryError,
    deliveryActions,
    fullContent,
    isAgentOrgInboxTranscript,
    messageImages,
    retryDelivery,
    rawPrompt,
    cachedFiles,
  };
}
