import { useAtomValue } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import ComposerShell from "@src/components/ComposerShell";
import { composerGlowVisibleAtom } from "@src/store/session/composerGlowVisibleAtom";

import type { InputAreaInteractiveModel } from "../hooks/useInputAreaInteractiveModel";
import EditModeHeader from "./EditModeHeader";
import {
  EditImagePreviews,
  getComposerShellClassName,
  getComposerShellVariant,
} from "./InputAreaChrome";
import { EditComposerBar, NormalComposerContent } from "./InputComposerBars";

interface InputAreaComposerShellProps {
  model: InputAreaInteractiveModel;
  placeholder: string | undefined;
  isEditMode: boolean;
  onEditCancel: (() => void) | undefined;
  onEditSendNow: ((text: string, imageDataUrls?: string[]) => void) | undefined;
  editLabel: string | undefined;
  editHeaderActions: boolean;
  showEditHeader: boolean;
  quietEditSurface: boolean;
  editImages: string[] | undefined;
  onRemoveEditImage: ((index: number) => void) | undefined;
  surfaceBg: boolean;
  topRowPills: React.ReactNode;
  composerShellRef: React.Ref<HTMLDivElement> | undefined;
  submitDisabled: boolean;
  showAgentControls: boolean;
  allowFileAttachments: boolean;
  autoFocus: boolean;
}

export const InputAreaComposerShell: React.FC<InputAreaComposerShellProps> = ({
  model,
  placeholder,
  isEditMode,
  onEditCancel,
  onEditSendNow,
  editLabel,
  editHeaderActions,
  showEditHeader,
  quietEditSurface,
  editImages,
  onRemoveEditImage,
  surfaceBg,
  topRowPills,
  composerShellRef,
  submitDisabled,
  showAgentControls,
  allowFileAttachments,
  autoFocus,
}) => {
  const { t } = useTranslation("sessions");
  const composerGlowVisible = useAtomValue(composerGlowVisibleAtom);
  const {
    composerInputRef,
    contextMenuKeyboardHandlerRef,
    slashCommandKeyboardHandlerRef,
    setIsInputFocused,
    handleInputBlur,
    handleContentChange,
    compactHintVisible,
    canvasHintVisible,
    handleAtMentionClose,
    isInputEmpty,
    showContextMenu,
    showSlashMenu,
    handleSlashCommand,
    handleSlashCommandClose,
    isCiteCode,
    selectedCiteRange,
    citeFileName,
    clearCiteCode,
    isWpGeneWorking,
    isPendingCancel,
    interruptSession,
    resumeSession,
    isHosted,
    canStopAgent,
    isSessionTerminal,
    dropTargetId,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    replyInfo,
    currentRepoPath,
    handleImagePaste,
    hasImages,
    promptPolish,
    isCursorIde,
    teamChatActive,
    currentTextEmpty,
    currentInputEmpty,
    genericResumeAvailable,
    stopSuppressedForEmptyInput,
    voiceFeatureEnabled,
    isContextualPanel,
    isContextual,
    isCompactRow,
    onEditorContentChange,
    handleOpenContextMenu,
    handleKeyboardAtMention,
    editContainerRef,
    handleEditSubmit,
    handleEditSendNow,
    clearReplyInfo,
    submitMessage,
    isDragOver,
    voice,
    showVoiceUi,
    modelPill,
    modePill,
    sessionId,
  } = model;

  return (
    <ComposerShell
      ref={isEditMode ? editContainerRef : composerShellRef}
      data-composer-menu-anchor
      data-chat-drop-target
      data-chat-drop-target-id={dropTargetId}
      data-chat-file-drop-disabled={allowFileAttachments ? undefined : true}
      data-testid={isEditMode ? "chat-message-edit-composer" : undefined}
      variant={getComposerShellVariant({
        compactShell: isCompactRow,
        isEditMode,
        quietEditSurface,
        surfaceBg,
      })}
      className={getComposerShellClassName({
        isDragOver,
        isEditMode,
        quietEditSurface,
        glowVisible: composerGlowVisible,
      })}
    >
      {isEditMode && !quietEditSurface && showEditHeader && (
        <EditModeHeader
          editLabel={editLabel ?? t("input.editingSentMessage")}
          editHeaderActions={editHeaderActions}
          onEditCancel={onEditCancel}
          onEditSubmit={handleEditSubmit}
        />
      )}

      <EditImagePreviews
        isEditMode={isEditMode}
        editImages={editImages}
        dropTargetId={dropTargetId}
        onRemoveEditImage={onRemoveEditImage}
      />

      {isEditMode ? (
        <EditComposerBar
          composerInputRef={composerInputRef}
          showContextMenu={showContextMenu}
          contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
          showSlashMenu={showSlashMenu}
          slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
          onSlashCommand={handleSlashCommand}
          onSlashCommandClose={handleSlashCommandClose}
          onContentChange={handleContentChange}
          onAtMention={handleKeyboardAtMention}
          onAtMentionClose={handleAtMentionClose}
          onSubmit={handleEditSubmit}
          onFocus={() => setIsInputFocused(true)}
          onBlur={handleInputBlur}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onImagePaste={allowFileAttachments ? handleImagePaste : undefined}
          onAddContent={handleOpenContextMenu}
          isCiteCode={isCiteCode}
          selectedCiteRange={selectedCiteRange}
          citeFileName={citeFileName}
          onClearCiteCode={clearCiteCode}
          replyInfo={replyInfo}
          onClearReplyInfo={clearReplyInfo}
          modePill={modePill}
          modelPill={modelPill}
          onEditCancel={onEditCancel}
          onEditSendNow={onEditSendNow ? handleEditSendNow : undefined}
          quietEditSurface={quietEditSurface}
          isInputEmpty={isInputEmpty()}
          hasImages={hasImages}
          isHosted={isHosted}
          canStopAgent={canStopAgent}
          canResume={genericResumeAvailable}
          onInterrupt={interruptSession}
          onResume={resumeSession}
          isCursorIde={isCursorIde}
        />
      ) : (
        <NormalComposerContent
          composerInputRef={composerInputRef}
          showContextMenu={showContextMenu}
          contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
          showSlashMenu={showSlashMenu}
          slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
          onSlashCommand={handleSlashCommand}
          onSlashCommandClose={handleSlashCommandClose}
          onContentChange={onEditorContentChange}
          onAtMention={handleKeyboardAtMention}
          onAtMentionClose={handleAtMentionClose}
          onSubmit={submitMessage}
          onFocus={() => setIsInputFocused(true)}
          onBlur={handleInputBlur}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onImagePaste={allowFileAttachments ? handleImagePaste : undefined}
          onAddContent={handleOpenContextMenu}
          isCiteCode={isCiteCode}
          selectedCiteRange={selectedCiteRange}
          citeFileName={citeFileName}
          onClearCiteCode={clearCiteCode}
          replyInfo={replyInfo}
          onClearReplyInfo={clearReplyInfo}
          modePill={modePill}
          modelPill={modelPill}
          isHosted={isHosted}
          canStopAgent={canStopAgent}
          canResume={genericResumeAvailable}
          onInterrupt={interruptSession}
          onResume={resumeSession}
          isCursorIde={isCursorIde}
          quoteSessionId={sessionId}
          showVoiceUi={showVoiceUi}
          voice={voice}
          currentRepoPath={currentRepoPath}
          isCompactRow={isCompactRow}
          contextualPanel={isContextualPanel}
          inlineLeadingContent={isContextual ? topRowPills : undefined}
          placeholder={
            teamChatActive ? t("input.commentPlaceholder") : placeholder
          }
          commentMode={teamChatActive}
          trailingHint={
            compactHintVisible
              ? t("input.compactArgHint")
              : canvasHintVisible
                ? t("input.canvasArgHint")
                : undefined
          }
          currentInputEmpty={currentInputEmpty}
          stopSuppressedForEmptyInput={stopSuppressedForEmptyInput}
          isWpGeneWorking={isWpGeneWorking}
          isPendingCancel={isPendingCancel}
          isSessionTerminal={isSessionTerminal}
          voiceFeatureEnabled={voiceFeatureEnabled}
          dropTargetId={dropTargetId}
          promptPolish={promptPolish}
          promptPolishDisabled={currentTextEmpty}
          submitDisabled={submitDisabled}
          showAgentControls={showAgentControls}
          showImageAttachments={allowFileAttachments}
          autoFocus={autoFocus}
        />
      )}
    </ComposerShell>
  );
};
