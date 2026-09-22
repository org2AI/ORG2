import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ComposerSendGroup from "@src/components/ComposerBar/ComposerSendGroup";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import ComposerExpandToggle from "@src/components/ComposerInput/ComposerExpandToggle";
import { useComposerExpansion } from "@src/components/ComposerInput/useComposerExpansion";
import { VoiceInputButton, VoiceRecordingBar } from "@src/components/Voice";
import { INPUT_AREA_CONTROL_GROUP_CLASS } from "@src/config/inputAreaTokens";
import ComposerBar from "@src/engines/ChatPanel/ComposerBar";
import type { PromptPolishControl } from "@src/engines/ChatPanel/hooks/useInputArea/types";
import type { UseVoiceInputResult } from "@src/hooks/voice";
import { Cancel01Icon, HugeiconsIcon, RotateLeft01Icon } from "@src/icons";

import ChatQuotePreview from "./ChatQuotePreview";
import CiteCodePreview from "./CiteCodePreview";
import ImageAttachmentPreview from "./ImageAttachmentPreview";
import InputActions from "./InputActions";
import InputEditor from "./InputEditor";
import PromptPolishButton from "./PromptPolishButton";
import ReplyInfoDisplay from "./ReplyInfoDisplay";

interface SharedComposerBarProps {
  composerInputRef: React.RefObject<ComposerInputRef | null>;
  showContextMenu: boolean;
  contextMenuKeyboardHandlerRef: React.MutableRefObject<
    ((event: React.KeyboardEvent) => boolean) | null
  >;
  showSlashMenu: boolean;
  slashCommandKeyboardHandlerRef: React.MutableRefObject<
    ((event: KeyboardEvent) => boolean) | null
  >;
  onSlashCommand: (query: string) => void;
  onSlashCommandClose: () => void;
  onAtMention: (query: string, position: { x: number; y: number }) => void;
  onAtMentionClose: () => void;
  onFocus: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onImagePaste?: (files: File[]) => void;
  onAddContent: () => void;
  isCiteCode: boolean;
  selectedCiteRange: { start: number; end: number } | null;
  citeFileName: string;
  onClearCiteCode: () => void;
  replyInfo: { isReply: boolean };
  onClearReplyInfo: () => void;
  modePill: React.ReactNode;
  modelPill: React.ReactNode;
  isHosted: boolean;
  canStopAgent: boolean;
  canResume: boolean;
  onInterrupt: () => Promise<void>;
  onResume: () => Promise<void>;
  isCursorIde: boolean;
}

interface EditComposerBarProps extends SharedComposerBarProps {
  onContentChange: (text: string) => void;
  onBlur: () => void;
  onSubmit: (capturedText?: string) => void;
  onEditCancel?: () => void;
  onEditSendNow?: () => void;
  quietEditSurface: boolean;
  isInputEmpty: boolean;
  hasImages: boolean;
}

const ComposerPrefixes: React.FC<
  Pick<
    SharedComposerBarProps,
    | "isCiteCode"
    | "selectedCiteRange"
    | "citeFileName"
    | "onClearCiteCode"
    | "replyInfo"
    | "onClearReplyInfo"
  >
> = ({
  isCiteCode,
  selectedCiteRange,
  citeFileName,
  onClearCiteCode,
  replyInfo,
  onClearReplyInfo,
}) => (
  <>
    <CiteCodePreview
      isCiteCode={isCiteCode}
      selectedCiteRange={selectedCiteRange}
      citeFileName={citeFileName}
      onClear={onClearCiteCode}
    />
    <ReplyInfoDisplay replyInfo={replyInfo} onClose={onClearReplyInfo} />
  </>
);

export const EditComposerBar: React.FC<EditComposerBarProps> = ({
  composerInputRef,
  showContextMenu,
  contextMenuKeyboardHandlerRef,
  showSlashMenu,
  slashCommandKeyboardHandlerRef,
  onSlashCommand,
  onSlashCommandClose,
  onContentChange,
  onAtMention,
  onAtMentionClose,
  onSubmit,
  onFocus,
  onBlur,
  onDragOver,
  onDragLeave,
  onDrop,
  onImagePaste,
  onAddContent,
  isCiteCode,
  selectedCiteRange,
  citeFileName,
  onClearCiteCode,
  replyInfo,
  onClearReplyInfo,
  modePill,
  modelPill,
  onEditCancel,
  onEditSendNow,
  quietEditSurface,
  isInputEmpty,
  hasImages,
  isHosted,
  canStopAgent,
  canResume,
  onInterrupt,
  onResume,
  isCursorIde,
}) => {
  const { t } = useTranslation("sessions");

  return (
    <ComposerBar
      onAddContent={onAddContent}
      showContextInfo={!isCursorIde}
      editorSlot={
        <InputEditor
          composerInputRef={composerInputRef}
          showContextMenu={showContextMenu}
          contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
          showSlashMenu={showSlashMenu}
          slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
          onSlashCommand={onSlashCommand}
          onSlashCommandClose={onSlashCommandClose}
          slashTriggerMode="command"
          onContentChange={onContentChange}
          onAtMention={onAtMention}
          onAtMentionClose={onAtMentionClose}
          onSubmit={onSubmit}
          onFocus={onFocus}
          onBlur={onBlur}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          placeholder={t("input.editPlaceholder")}
          onImagePaste={onImagePaste}
        />
      }
      leftPrefix={
        <ComposerPrefixes
          isCiteCode={isCiteCode}
          selectedCiteRange={selectedCiteRange}
          citeFileName={citeFileName}
          onClearCiteCode={onClearCiteCode}
          replyInfo={replyInfo}
          onClearReplyInfo={onClearReplyInfo}
        />
      }
      pills={modePill}
      modelPill={modelPill}
      submitButton={
        onEditSendNow ? (
          <div className="flex items-center gap-1">
            <Button
              variant="tertiary"
              size="mini"
              shape="circle"
              iconOnly
              icon={
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  data-icon="x"
                  size={13}
                  strokeWidth={2}
                />
              }
              aria-label={t("common:actions.cancel")}
              onClick={onEditCancel}
            />
            <Button
              variant="tertiary"
              size="mini"
              shape="round"
              onClick={onEditSendNow}
            >
              {t("common:actions.sendNow")}
            </Button>
            <Button
              variant="primary"
              size="mini"
              shape="round"
              onClick={() => onSubmit()}
            >
              {t("common:actions.save")}
            </Button>
          </div>
        ) : quietEditSurface ? (
          <Button
            variant="primary"
            tone="warning"
            size="mini"
            shape="round"
            icon={
              <HugeiconsIcon
                icon={RotateLeft01Icon}
                data-icon="rotate-ccw"
                size={13}
                strokeWidth={2}
              />
            }
            onClick={() => onSubmit()}
          >
            {t("common:actions.resend")}
          </Button>
        ) : (
          <InputActions
            isInputEmpty={isInputEmpty && !hasImages}
            isWpGeneWorking={false}
            isPendingCancel={false}
            isHosted={isHosted}
            canStopAgent={canStopAgent}
            canResume={canResume}
            isSessionTerminal={false}
            onSubmit={onSubmit}
            onInterrupt={onInterrupt}
            onResume={onResume}
          />
        )
      }
    />
  );
};

interface NormalComposerContentProps extends SharedComposerBarProps {
  showVoiceUi: boolean;
  voice: UseVoiceInputResult;
  currentRepoPath?: string;
  /** Render the editor and controls in the compact single-row capsule. */
  isCompactRow: boolean;
  contextualPanel?: boolean;
  inlineLeadingContent?: React.ReactNode;
  onContentChange: (text: string) => void;
  onBlur: () => void;
  onSubmit: (capturedText?: string) => void;
  placeholder?: string;
  commentMode?: boolean;
  /** Inline ghost hint after the last content node (see ComposerInput) */
  trailingHint?: string | null;
  currentInputEmpty: boolean;
  stopSuppressedForEmptyInput: boolean;
  isWpGeneWorking: boolean;
  isPendingCancel: boolean;
  isSessionTerminal: boolean;
  voiceFeatureEnabled: boolean;
  dropTargetId: string;
  promptPolish: PromptPolishControl;
  promptPolishDisabled: boolean;
  submitDisabled?: boolean;
  showAgentControls?: boolean;
  showImageAttachments?: boolean;
  autoFocus?: boolean;
  /** Session whose quoted-reply chip renders above the editor. */
  quoteSessionId?: string | null;
}

export const NormalComposerContent: React.FC<NormalComposerContentProps> = ({
  composerInputRef,
  showContextMenu,
  contextMenuKeyboardHandlerRef,
  showSlashMenu,
  slashCommandKeyboardHandlerRef,
  onSlashCommand,
  onSlashCommandClose,
  onContentChange,
  onAtMention,
  onAtMentionClose,
  onSubmit,
  onFocus,
  onBlur,
  onDragOver,
  onDragLeave,
  onDrop,
  onImagePaste,
  onAddContent,
  isCiteCode,
  selectedCiteRange,
  citeFileName,
  onClearCiteCode,
  replyInfo,
  onClearReplyInfo,
  modePill,
  modelPill,
  isHosted,
  canStopAgent,
  canResume,
  onInterrupt,
  onResume,
  isCursorIde,
  showVoiceUi,
  voice,
  currentRepoPath,
  isCompactRow,
  contextualPanel = false,
  inlineLeadingContent,
  placeholder,
  commentMode = false,
  trailingHint,
  currentInputEmpty,
  stopSuppressedForEmptyInput,
  isWpGeneWorking,
  isPendingCancel,
  isSessionTerminal,
  voiceFeatureEnabled,
  dropTargetId,
  promptPolish,
  promptPolishDisabled,
  submitDisabled,
  showAgentControls = true,
  showImageAttachments = true,
  autoFocus = false,
  quoteSessionId,
}) => {
  const { t } = useTranslation("sessions");
  const contentRef = useRef<HTMLDivElement>(null);
  // The recording bar replaces the editor, so pause while it shows; the
  // observers re-attach to the editor that mounts afterwards.
  const expansion = useComposerExpansion(
    contentRef,
    !isCompactRow && !showVoiceUi
  );

  return (
    <div ref={contentRef} className="flex min-h-0 w-full flex-col">
      <ChatQuotePreview sessionId={quoteSessionId} />
      {showImageAttachments && (
        <ImageAttachmentPreview ownerId={dropTargetId} />
      )}
      {showVoiceUi ? (
        <VoiceRecordingBar
          elapsedSeconds={voice.elapsedSeconds}
          onCancel={voice.cancel}
          onAccept={voice.stop}
          onAddContent={onAddContent}
        />
      ) : (
        <ComposerBar
          onAddContent={onAddContent}
          repoPath={currentRepoPath}
          inlineLayout={isCompactRow}
          showContextInfo={
            showAgentControls && !isCursorIde && !contextualPanel
          }
          editorSlot={
            <InputEditor
              key="chat-panel-input-editor"
              composerInputRef={composerInputRef}
              showContextMenu={showContextMenu}
              contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
              showSlashMenu={showSlashMenu}
              slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
              onSlashCommand={onSlashCommand}
              onSlashCommandClose={onSlashCommandClose}
              onContentChange={onContentChange}
              onAtMention={onAtMention}
              onAtMentionClose={onAtMentionClose}
              onSubmit={onSubmit}
              onFocus={onFocus}
              onBlur={onBlur}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              placeholder={placeholder || t("input.defaultPlaceholder")}
              trailingHint={trailingHint}
              onImagePaste={onImagePaste}
              compact={isCompactRow}
              autoFocus={autoFocus}
              editorClassName={expansion.editorClassName}
              leadingContent={
                contextualPanel ? inlineLeadingContent : undefined
              }
            />
          }
          leftPrefix={
            <>
              <ComposerPrefixes
                isCiteCode={isCiteCode}
                selectedCiteRange={selectedCiteRange}
                citeFileName={citeFileName}
                onClearCiteCode={onClearCiteCode}
                replyInfo={replyInfo}
                onClearReplyInfo={onClearReplyInfo}
              />
              {!contextualPanel && inlineLeadingContent}
            </>
          }
          pills={
            <div className={INPUT_AREA_CONTROL_GROUP_CLASS}>{modePill}</div>
          }
          modelPill={modelPill}
          submitButton={
            <div className="flex h-7 items-center gap-0.5">
              {showAgentControls && !contextualPanel && (
                <PromptPolishButton
                  control={promptPolish}
                  disabled={promptPolishDisabled}
                />
              )}
              {expansion.showToggle && (
                <ComposerExpandToggle
                  expanded={expansion.expanded}
                  onToggle={expansion.toggle}
                />
              )}
              <ComposerSendGroup>
                {showAgentControls && voiceFeatureEnabled && (
                  <VoiceInputButton
                    onPressStart={voice.start}
                    onPressEnd={voice.stop}
                    disabled={!voice.isSupported}
                  />
                )}
                <InputActions
                  isInputEmpty={currentInputEmpty}
                  isWpGeneWorking={
                    stopSuppressedForEmptyInput ? false : isWpGeneWorking
                  }
                  isPendingCancel={
                    stopSuppressedForEmptyInput ? false : isPendingCancel
                  }
                  isHosted={isHosted}
                  canStopAgent={
                    stopSuppressedForEmptyInput ? false : canStopAgent
                  }
                  canResume={canResume}
                  isSessionTerminal={isSessionTerminal}
                  onSubmit={onSubmit}
                  onInterrupt={onInterrupt}
                  onResume={onResume}
                  submitDisabled={submitDisabled}
                  commentMode={commentMode}
                />
              </ComposerSendGroup>
            </div>
          }
        />
      )}
    </div>
  );
};
