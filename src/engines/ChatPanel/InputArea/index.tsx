import React, { memo } from "react";

import { useSessionDiscovery } from "@src/engines/SessionCore";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import FollowUpSuggestionBar from "./components/FollowUpSuggestionBar";
import {
  InputAreaTopRows,
  QuietEditStatus,
} from "./components/InputAreaChrome";
import { InputAreaComposerShell } from "./components/InputAreaComposerShell";
import { InputAreaPortals } from "./components/InputAreaPortals";
import SessionReadOnlyBar from "./components/SessionReadOnlyBar";
import { useImageMenuTarget } from "./hooks/useImageMenuTarget";
import { useInputAreaInteractiveModel } from "./hooks/useInputAreaInteractiveModel";
import { useStopOnDoubleEscape } from "./hooks/useStopOnDoubleEscape";
import type { InputAreaProps } from "./inputAreaProps";

/**
 * Gateway: resolves the session ID, then either renders the read-only bar
 * (cursor IDE) or delegates to `InputAreaInteractive` for all other sessions.
 * Keeping the split here means `InputAreaInteractive` never mounts its heavy
 * hooks for read-only sessions.
 */
const InputArea: React.FC<InputAreaProps> = memo((props) => {
  const { sessionId: propSessionId, isEditMode = false } = props;

  useSessionDiscovery({ autoLoad: true });
  const { sessionId } = useSessionId({ propSessionId });
  const isCursorIde = sessionId ? isCursorIdeSession(sessionId) : false;

  if (isCursorIde && !isEditMode && sessionId) {
    return <SessionReadOnlyBar />;
  }

  return <InputAreaInteractive {...props} />;
});

InputArea.displayName = "InputArea";

const InputAreaInteractive: React.FC<InputAreaProps> = memo(
  ({
    placeholder,
    isEditMode = false,
    initialContent,
    onEditSubmit,
    onEditSendNow,
    onEditCancel,
    editLabel,
    editHeaderActions = true,
    showEditHeader = true,
    quietEditSurface = false,
    editImages,
    onRemoveEditImage,
    surfaceBg = false,
    omitChatHeader = false,
    sessionId: propSessionId,
    controlSessionId,
    onSubmitOverride,
    customMentionOptions,
    topRowPills,
    topRowTrailingContent,
    statusBanners,
    composerTray,
    followUpSuggestions = [],
    onFollowUpSuggestionSent,
    composerShellRef,
    composerInputRef: externalComposerInputRef,
    acceptDraggedPills = true,
    disableStopWhenEmpty = false,
    submitDisabled = false,
    sessionScope = "active",
    showAgentControls = true,
    allowFileAttachments = true,
    enableAgentInterceptors = true,
    autoFocus = false,
    slashItemCategories,
    presentation = "default",
  }) => {
    const model = useInputAreaInteractiveModel({
      isEditMode,
      initialContent,
      onEditSubmit,
      onEditSendNow,
      onEditCancel,
      propSessionId,
      controlSessionId,
      onSubmitOverride,
      customMentionOptions,
      onFollowUpSuggestionSent,
      externalComposerInputRef,
      acceptDraggedPills,
      disableStopWhenEmpty,
      submitDisabled,
      sessionScope,
      showAgentControls,
      enableAgentInterceptors,
      slashItemCategories,
      presentation,
    });
    const {
      composerInputRef,
      containerRef,
      contextMenuKeyboardHandlerRef,
      slashCommandKeyboardHandlerRef,
      showContextMenu,
      atSearchQuery,
      handleAtSelect,
      handleCustomMentionSelect,
      customMentionOptions: activeCustomMentionOptions,
      showSlashMenu,
      handleSlashCommandClose,
      handleSlashSelect,
      currentMode,
      includeProjectMode,
      slashLoading,
      slashQuery,
      fileInputRef,
      handleFileUpload,
      isWpGeneWorking,
      isPendingCancel,
      interruptSession,
      canStopAgent,
      dropTargetId,
      currentRepoPath,
      skillWorkspacePaths,
      sessionId,
      pinnedActionsVisible,
      handlePinnedActionsContextMenu,
      isContextual,
      handleContextMenuClose,
      handleContextModeSelect,
      handleContextImageUpload,
      handleEditKeyDown,
      submitFollowUpSuggestion,
      handleContainerDragOver,
      handleContainerDragLeave,
      handleContainerDrop,
      visibleSlashItems,
    } = model;

    useImageMenuTarget({
      sessionId,
      enabled:
        allowFileAttachments &&
        !isEditMode &&
        !submitDisabled &&
        !model.wpReadOnly,
      add: model.handleImagePaste,
      input: composerInputRef,
    });

    // Double-press Escape to stop the running turn. Active only while a turn
    // is running and stoppable; a single Escape is inert.
    useStopOnDoubleEscape(isWpGeneWorking && canStopAgent, interruptSession);

    return (
      <div
        ref={containerRef}
        data-chat-input-shell
        data-testid="chat-input"
        data-image-owner-id={allowFileAttachments ? dropTargetId : undefined}
        className="flex w-full flex-col"
        onKeyDown={isEditMode ? handleEditKeyDown : undefined}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onDrop={handleContainerDrop}
        onContextMenu={
          !isEditMode && !isContextual
            ? handlePinnedActionsContextMenu
            : undefined
        }
      >
        <div className="relative flex flex-col gap-0.5">
          {!isContextual && (
            <InputAreaTopRows
              isEditMode={isEditMode}
              omitChatHeader={omitChatHeader}
              topRowPills={topRowPills}
              topRowTrailingContent={topRowTrailingContent}
              composerInputRef={composerInputRef}
              sessionId={sessionId}
              showPinnedActions={pinnedActionsVisible}
              skillWorkspacePaths={skillWorkspacePaths}
            />
          )}
          <QuietEditStatus
            isEditMode={isEditMode}
            quietEditSurface={quietEditSurface}
            showEditHeader={showEditHeader}
            editLabel={editLabel}
          />
          {!isEditMode && statusBanners}

          {!isEditMode && (
            <FollowUpSuggestionBar
              suggestions={followUpSuggestions}
              disabled={submitDisabled || isWpGeneWorking || isPendingCancel}
              onSelect={submitFollowUpSuggestion}
            />
          )}

          {composerTray}

          <InputAreaComposerShell
            model={model}
            placeholder={placeholder}
            isEditMode={isEditMode}
            onEditCancel={onEditCancel}
            onEditSendNow={onEditSendNow}
            editLabel={editLabel}
            editHeaderActions={editHeaderActions}
            showEditHeader={showEditHeader}
            quietEditSurface={quietEditSurface}
            editImages={editImages}
            onRemoveEditImage={onRemoveEditImage}
            surfaceBg={surfaceBg}
            topRowPills={topRowPills}
            composerShellRef={composerShellRef}
            submitDisabled={submitDisabled}
            showAgentControls={showAgentControls}
            allowFileAttachments={allowFileAttachments}
            autoFocus={autoFocus}
          />
        </div>

        <InputAreaPortals
          contextMenuVisible={showContextMenu}
          containerRef={containerRef}
          onContextMenuClose={handleContextMenuClose}
          onAtSelect={handleAtSelect}
          onImageUpload={
            allowFileAttachments ? handleContextImageUpload : undefined
          }
          customMentionOptions={activeCustomMentionOptions}
          onCustomMentionSelect={handleCustomMentionSelect}
          atSearchQuery={atSearchQuery}
          currentRepoPath={currentRepoPath}
          contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
          isEditMode={isEditMode}
          showSlashMenu={showSlashMenu}
          filteredSlashItems={visibleSlashItems}
          slashLoading={slashLoading}
          currentMode={currentMode}
          includeProjectMode={includeProjectMode}
          slashQuery={slashQuery}
          onSlashCommandClose={handleSlashCommandClose}
          onSlashSelect={handleSlashSelect}
          onContextModeSelect={handleContextModeSelect}
          slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
        />

        {allowFileAttachments && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="chat-file-upload-input"
            onChange={handleFileUpload}
          />
        )}
      </div>
    );
  }
);

InputAreaInteractive.displayName = "InputAreaInteractive";

export default InputArea;
