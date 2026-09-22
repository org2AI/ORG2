import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  CHAT_BUBBLE_TOOLBAR_BUTTON_BASE_CLASS,
  CHAT_BUBBLE_TOOLBAR_BUTTON_CLASS,
} from "@src/components/ChatBubble";
import { HugeiconsIcon, PencilEdit01Icon, Undo02Icon } from "@src/icons";

import RawPromptToggle from "../RawPromptToggle";
import type { describeModelLabel } from "../rawPromptModelLabel";

interface UserChatItemToolbarProps {
  rawPrompt: string;
  sessionId: string | undefined;
  isEditableDisplay: boolean;
  toolbarActions?: ReactNode;
  deliveryStatus: string | null;
  timestampLabel: string | null;
  messageTimestamp: string | null;
  modelLabel: ReturnType<typeof describeModelLabel>;
  modelId?: string | null;
  isRawPromptOpen: boolean;
  onRawPromptOpenChange: (open: boolean) => void;
  canEditFailed: boolean;
  isRemoteSharedMessage: boolean;
  onRestoreCheckpoint?: () => void;
  onEditClick: () => void;
}

/** Hover toolbar under the bubble: timestamp/model, raw prompt, restore, edit. */
export function UserChatItemToolbar({
  rawPrompt,
  sessionId,
  isEditableDisplay,
  toolbarActions,
  deliveryStatus,
  timestampLabel,
  messageTimestamp,
  modelLabel,
  modelId,
  isRawPromptOpen,
  onRawPromptOpenChange,
  canEditFailed,
  isRemoteSharedMessage,
  onRestoreCheckpoint,
  onEditClick,
}: UserChatItemToolbarProps) {
  const { t } = useTranslation("sessions");
  if (
    !(
      rawPrompt.trim() ||
      isEditableDisplay ||
      toolbarActions ||
      deliveryStatus === "pending"
    )
  ) {
    return null;
  }
  return (
    <div className="relative mt-1 flex min-h-6 items-center px-1 text-[11px] leading-none text-text-3">
      {(rawPrompt.trim() ||
        isEditableDisplay ||
        toolbarActions ||
        timestampLabel ||
        modelLabel) && (
        <div
          className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 group-hover/msg:opacity-100 focus-within:opacity-100 ${
            isRawPromptOpen || canEditFailed ? "opacity-100" : "opacity-0"
          } ${isRemoteSharedMessage ? "left-full ml-1" : "right-full mr-1"}`}
        >
          {(timestampLabel || modelLabel) && (
            <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-text-3">
              {timestampLabel && messageTimestamp && (
                <time
                  dateTime={messageTimestamp}
                  data-testid="chat-message-timestamp"
                >
                  {timestampLabel}
                </time>
              )}
              {timestampLabel && modelLabel && (
                <span aria-hidden="true">·</span>
              )}
              {modelLabel && (
                <span
                  data-testid="chat-message-model"
                  title={modelId ?? undefined}
                >
                  {modelLabel.name}
                  {modelLabel.variant ? ` · ${modelLabel.variant}` : ""}
                </span>
              )}
            </span>
          )}
          {rawPrompt.trim() && sessionId && (
            <RawPromptToggle
              rawText={rawPrompt}
              sessionId={sessionId}
              onOpenChange={onRawPromptOpenChange}
            />
          )}
          {isEditableDisplay && onRestoreCheckpoint && (
            <Button
              variant="tertiary"
              tone="danger"
              size="mini"
              aria-label={t("chat.restoreCheckpoint")}
              iconOnly
              icon={
                <HugeiconsIcon
                  icon={Undo02Icon}
                  data-icon="undo-2"
                  size={15}
                  strokeWidth={1.75}
                />
              }
              data-testid="chat-message-restore-checkpoint"
              title={t("chat.restoreCheckpoint")}
              className={`${CHAT_BUBBLE_TOOLBAR_BUTTON_BASE_CLASS} text-text-3 hover:text-danger-6`}
              onClick={(e) => {
                e.stopPropagation();
                onRestoreCheckpoint();
              }}
            />
          )}
          {isEditableDisplay && (
            <Button
              variant="tertiary"
              size="mini"
              iconOnly
              icon={
                <HugeiconsIcon
                  icon={PencilEdit01Icon}
                  data-icon="pencil-line"
                  size={14}
                  strokeWidth={1.75}
                />
              }
              data-testid="chat-message-user-edit-button"
              className={`${CHAT_BUBBLE_TOOLBAR_BUTTON_CLASS} text-text-3 hover:text-text-1`}
              onClick={(e) => {
                e.stopPropagation();
                onEditClick();
              }}
            />
          )}
          {toolbarActions}
        </div>
      )}
      {deliveryStatus === "pending" && (
        <span data-testid="chat-message-delivery-pending">
          {t("common:status.sending")}
        </span>
      )}
    </div>
  );
}
