import React, {
  type MouseEvent,
  type SyntheticEvent,
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import PageNotice from "@src/components/PageNotice";
import PersonAvatar from "@src/components/PersonAvatar";
import { REPO_SETUP_PROMPT_MARKER } from "@src/config/repoSetupMarker";
import type { OptimizedChatItem } from "@src/engines/ChatPanel/ChatHistory/chatItemPipeline/types";
import { ChatImageThumbnailRow } from "@src/engines/ChatPanel/ChatImageThumbnail";
import { conversationSenderStampOf } from "@src/engines/SessionCore/conversations/conversationSenderMetadata";

import UserMessageContent from "../ChatHistory/components/UserMessageContent";
import InputArea from "../InputArea";
import SessionIdentityIcon from "../components/SessionIdentityIcon";
import { UserChatItemBubble } from "./UserChatItem/UserChatItemBubble";
import { UserChatItemToolbar } from "./UserChatItem/UserChatItemToolbar";
import { useUserChatItemEdit } from "./UserChatItem/useUserChatItemEdit";
import { useUserChatItemModel } from "./UserChatItem/useUserChatItemModel";
import { normalizeUserMessageText } from "./normalizeUserMessageText";
import { wasSubmittedByViewer } from "./parentAgentSender";
import { resolveUserMessageSide } from "./userMessageSide";

const PLAN_APPROVED_PREFIX = "[Plan approved";

// ============================================
// Types
// ============================================

interface UserChatItemProps {
  chatItem: OptimizedChatItem;
  /** Keep the short preview used by paginated/pinned turn headers. */
  compactPreview?: boolean;
  /** Provider-exact model from the assistant response in this turn. */
  modelId?: string | null;
  onEditSubmit?: (newText: string, imageDataUrls?: string[]) => void;
  /** Extra actions rendered in the message action toolbar. */
  toolbarActions?: React.ReactNode;
  /**
   * Restore the session to this message's checkpoint WITHOUT re-sending it
   * (Cursor-style restore). When provided, a restore button is shown next to
   * the edit button.
   */
  onRestoreCheckpoint?: () => void;
}

// ============================================
// Component
// ============================================

const UserChatItem = ({
  chatItem,
  compactPreview = true,
  modelId,
  onEditSubmit,
  toolbarActions,
  onRestoreCheckpoint,
}: UserChatItemProps) => {
  const { t } = useTranslation("sessions");

  const [isExpanded, setIsExpanded] = useState(false);
  const [isRawPromptOpen, setIsRawPromptOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);

  const {
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
  } = useUserChatItemModel({ chatItem, modelId, onEditSubmit });

  const handleToggleTruncation = useCallback(
    (event: SyntheticEvent) => {
      event.stopPropagation();
      if (isExpanded) {
        messageContentRef.current?.scrollTo({ top: 0 });
      }
      setIsExpanded((prev) => !prev);
    },
    [isExpanded]
  );

  const handleTogglePreview = useCallback((event: MouseEvent, file: string) => {
    event.stopPropagation();
    setPreviewFile((prev) => (prev === file ? null : file));
  }, []);

  const handleClosePreview = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    setPreviewFile(null);
  }, []);

  const {
    isEditing,
    editImageList,
    handleEditClick,
    handleEditCancel,
    handleRemoveEditImage,
    handleEditSubmitInternal,
  } = useUserChatItemEdit({ messageImages, deliveryActions, onEditSubmit });

  // Edit mode
  if (isEditing) {
    return (
      <InputArea
        isEditMode
        initialContent={editedText}
        onEditSubmit={handleEditSubmitInternal}
        onEditCancel={handleEditCancel}
        editLabel={t("input.editingSentMessage")}
        editHeaderActions={false}
        quietEditSurface
        editImages={editImageList}
        onRemoveEditImage={handleRemoveEditImage}
      />
    );
  }

  const isRepoSetup = editedText.startsWith(REPO_SETUP_PROMPT_MARKER);
  const isPlanApproved = fullContent.startsWith(PLAN_APPROVED_PREFIX);
  const planApprovedEdited =
    isPlanApproved && fullContent.startsWith("[Plan approved (edited)");
  const isEditableDisplay = Boolean(
    (onEditSubmit || deliveryActions.canEditFailed) &&
    deliveryStatus !== "pending" &&
    !isRepoSetup &&
    !isAgentOrgInboxTranscript &&
    !isPlanApproved &&
    (!event?.args?.["sessionDiscussion"] || deliveryStatus === "failed") &&
    (!conversationSenderStampOf(event) ||
      senderResolution.relationship === "viewer" ||
      deliveryActions.canEditFailed)
  );
  const hasDisplayContent = Boolean(
    fullContent.trim() ||
    messageImages?.length ||
    cachedFiles.length ||
    isRepoSetup ||
    isPlanApproved
  );
  if (!hasDisplayContent) return null;

  const ownerSide =
    senderResolution.relationship === "viewer"
      ? "right"
      : senderResolution.relationship === "other"
        ? "left"
        : resolveUserMessageSide(event);
  // Only turns that would otherwise read as the viewer's own are reattributed
  // — a teammate's shared message already names its own sender and keeps it —
  // and only those the viewer did not actually submit. Someone can open a
  // subagent session and type into it; that message carries a turn-intent id
  // and stays theirs, while the parent's dispatch carries none.
  const isParentAgentMessage =
    Boolean(parentAgentSender) &&
    ownerSide === "right" &&
    !wasSubmittedByViewer(event);
  const messageSide = isParentAgentMessage ? "left" : ownerSide;
  const isRemoteSharedMessage = messageSide === "left";
  const senderName = isParentAgentMessage
    ? parentAgentSender?.parentSession?.name?.trim() ||
      t("chat.parentAgentSender")
    : senderResolution.identity?.displayName?.trim() || null;

  // Attachments never sit inside the text fold. Continuous chat lifts them
  // into their own row above the bubble, aligned to the message side;
  // paginated headers keep them in the bubble, above the folded text.
  const imagesAboveBubble = !compactPreview && Boolean(messageImages?.length);
  const bubbleText = normalizeUserMessageText(
    fullContent,
    messageImages
  ).trim();
  const showBubble =
    !imagesAboveBubble ||
    isRepoSetup ||
    isPlanApproved ||
    cachedFiles.length > 0 ||
    (bubbleText.length > 0 && bubbleText !== "(image)");

  const messageContent = (
    <UserMessageContent
      text={fullContent}
      images={messageImages}
      showImages={false}
      mentions={mentions}
    />
  );

  // Display mode
  const display = (
    <>
      {imagesAboveBubble && messageImages && (
        <ChatImageThumbnailRow
          images={messageImages}
          className={`mb-1.5 max-w-[min(600px,100%)] ${
            isRemoteSharedMessage ? "justify-start" : "justify-end"
          }`}
        />
      )}
      {showBubble && (
        <UserChatItemBubble
          isEditableDisplay={isEditableDisplay}
          onEditClick={handleEditClick}
          isRepoSetup={isRepoSetup}
          isPlanApproved={isPlanApproved}
          planApprovedEdited={planApprovedEdited}
          fullContent={fullContent}
          messageImages={messageImages}
          compactPreview={compactPreview}
          messageContent={messageContent}
          messageContentRef={messageContentRef}
          isExpanded={isExpanded}
          onToggleTruncation={handleToggleTruncation}
          cachedFiles={cachedFiles}
          previewFile={previewFile}
          onTogglePreview={handleTogglePreview}
          onClosePreview={handleClosePreview}
        />
      )}
      <UserChatItemToolbar
        rawPrompt={rawPrompt}
        sessionId={event?.sessionId}
        isEditableDisplay={isEditableDisplay}
        toolbarActions={toolbarActions}
        deliveryStatus={deliveryStatus}
        timestampLabel={timestampLabel}
        messageTimestamp={messageTimestamp}
        modelLabel={modelLabel}
        modelId={modelId}
        isRawPromptOpen={isRawPromptOpen}
        onRawPromptOpenChange={setIsRawPromptOpen}
        canEditFailed={deliveryActions.canEditFailed}
        isRemoteSharedMessage={isRemoteSharedMessage}
        onRestoreCheckpoint={onRestoreCheckpoint}
        onEditClick={handleEditClick}
      />
    </>
  );

  return (
    <>
      <div
        className={`group/msg flex w-full flex-col ${
          isRemoteSharedMessage ? "items-start pr-24" : "items-end pl-24"
        }`}
        data-message-side={messageSide}
      >
        {isRemoteSharedMessage && senderName ? (
          <div className="flex max-w-full items-start gap-2.5">
            <span
              className="mt-0.5 shrink-0"
              title={senderName}
              aria-label={senderName}
              data-testid={
                isParentAgentMessage
                  ? "parent-agent-sender-avatar"
                  : "shared-message-sender-avatar"
              }
            >
              {isParentAgentMessage ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full"
                  style={{ backgroundColor: "var(--color-fill-2)" }}
                >
                  <SessionIdentityIcon
                    session={parentAgentSender?.parentSession}
                    sessionId={parentAgentSender?.parentSessionId ?? ""}
                  />
                </span>
              ) : (
                <PersonAvatar
                  size={24}
                  name={senderName}
                  src={senderResolution.identity?.avatarUrl}
                />
              )}
            </span>
            <div className="flex min-w-0 flex-col items-start">
              <span className="mb-0.5 text-xs font-medium text-text-3">
                {senderName}
              </span>
              {display}
            </div>
          </div>
        ) : (
          display
        )}
      </div>
      {deliveryStatus === "failed" && (
        <PageNotice
          title={t("chat.failedToSendMessage")}
          dataTestId="chat-message-delivery-failed"
          action={
            retryDelivery
              ? {
                  label: t("common:actions.retry"),
                  onClick: retryDelivery,
                }
              : undefined
          }
        >
          {deliveryError && (
            <div className="wrap-anywhere whitespace-pre-wrap">
              {deliveryError}
            </div>
          )}
        </PageNotice>
      )}
    </>
  );
};

export default memo(UserChatItem);
