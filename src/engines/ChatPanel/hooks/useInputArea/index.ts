/**
 * useInputArea Hook
 *
 * Description: Handles all business logic for the ChatPanel InputArea
 *
 * Features:
 * - Message state management (text, expanded state)
 * - @ Mention system (dropdown, file/folder/git mentions)
 * - Context management (add/remove context items)
 * - File attachments (drag-drop and file picker)
 * - Cite code integration (code snippets from editor)
 * - Language detection (auto-detect Chinese/English)
 * - Message submission (format and send messages)
 * - Keyboard shortcuts (Enter, Shift+Enter, Escape)
 *
 * @example
 * const {
 *   composerInputRef, handleDivSubmit, clearCiteCode,
 *   handleUploadClick, handleAtMention, ...
 * } = useInputArea();
 */
import { useCallback, useId } from "react";

import { useChatContext } from "@src/contexts/workspace/ChatContext";
import { useDataContext } from "@src/contexts/workspace/DataContext";
import { useSessionDraftField } from "@src/hooks/session/useSessionPatch";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import type { UseInputAreaOptions, UseInputAreaReturn } from "./types";
import { useAtMention } from "./useAtMention";
import { useCiteCode } from "./useCiteCode";
import { useDragDrop } from "./useDragDrop";
import { useFileSelection } from "./useFileSelection";
import { useImageAttachment } from "./useImageAttachment";
import { useInputAreaContentChange } from "./useInputAreaContentChange";
import { useInputAreaDraftRestore } from "./useInputAreaDraftRestore";
import { useInputAreaEffects } from "./useInputAreaEffects";
import { useInputAreaImageDraft } from "./useInputAreaImageDraft";
import { useInputAreaMentionSources } from "./useInputAreaMentionSources";
import { useInputAreaRefs } from "./useInputAreaRefs";
import { useInputAreaReplyTarget } from "./useInputAreaReplyTarget";
import { useInputAreaSessionState } from "./useInputAreaSessionState";
import { useInputAreaState } from "./useInputAreaState";
import { useProgrammaticInputMutation } from "./useProgrammaticInputMutation";
import { usePromptPolish } from "./usePromptPolish";
import { useSlashCommand } from "./useSlashCommand";
import { useSubmitMessage } from "./useSubmitMessage";
import { useUploadContext } from "./useUploadContext";

export function useInputArea(
  options: UseInputAreaOptions = {}
): UseInputAreaReturn {
  const {
    customMentionOptions,
    onSubmitOverride,
    sessionId: propSessionId,
    controlSessionId,
    sessionScope = "active",
    submitDisabled = false,
    enableAgentInterceptors = true,
    executionControlsEnabled = true,
  } = options;

  // ============================================
  // Context Integration
  // ============================================

  const { feedBackInfo: feedBack, setFeedBackInfo: setFeedBack } =
    useChatContext();

  const { localContextList } = useDataContext();

  // ============================================
  // Session, execution state, and repo context
  // ============================================

  const {
    handleSessInputChange,
    handleSessChatSubmit,
    stopSession,
    resumeSession,
    isHosted,
    canStopAgent,
    canResume,
    wpReadOnly,
    isSessionActive,
    isPendingCancel,
    isSessionTerminal,
    chatRoundCount,
    planMentionSource,
    activeSessionId,
    draftSessionId,
    isWpGeneWorking,
    activeSession,
    currentRepoPath,
    skillWorkspacePaths,
  } = useInputAreaSessionState({
    propSessionId,
    controlSessionId,
    sessionScope,
    executionControlsEnabled,
  });

  // ============================================
  // Sub-hooks
  // ============================================

  const refs = useInputAreaRefs();
  const reactDropTargetId = useId();
  const dropTargetId = `chat-drop-${reactDropTargetId.replace(/:/g, "")}`;
  const state = useInputAreaState();
  const { isDark } = useCurrentTheme();
  const citeCode = useCiteCode();

  const mergedCustomMentionOptions = useInputAreaMentionSources({
    activeSessionId,
    chatRoundCount,
    isWpGeneWorking,
    currentRepoPath,
    planMentionSource,
    customMentionOptions,
  });

  // ============================================
  // Per-session Draft Persistence (P3)
  // ============================================
  //
  // The chat composer's text is mirrored onto `sessions.draft_text` so it
  // survives navigation, app restarts, and background row refreshes.
  // Three things to coordinate:
  //   1. On session switch, restore the persisted draft into ComposerInput.
  //   2. While typing, debounce-write the latest text via `setDraft`.
  //   3. On send, immediately clear the draft (`flushDraft("")`) so the
  //      next session activation doesn't see a stale value.
  const {
    draftText: persistedDraft,
    setDraft,
    flushDraft,
  } = useSessionDraftField(draftSessionId);
  const {
    replyTargetEventId,
    clearReplyTarget,
    effectiveReplyInfo,
    setReplyInfoBridge,
  } = useInputAreaReplyTarget(draftSessionId);

  const fileSelection = useFileSelection({
    composerInputRef: refs.composerInputRef,
    hasContentRef: refs.hasContentRef,
  });

  const atMention = useAtMention({
    composerInputRef: refs.composerInputRef,
    hasContentRef: refs.hasContentRef,
    setShowContextMenu: state.setShowContextMenu,
    setAtSearchQuery: state.setAtSearchQuery,
    handleSelectFile: fileSelection.handleSelectFile,
  });

  const slashCommand = useSlashCommand({
    composerInputRef: refs.composerInputRef,
    setShowSlashMenu: state.setShowSlashMenu,
    setSlashQuery: state.setSlashQuery,
    workspacePaths: skillWorkspacePaths,
    sessionId: activeSessionId,
  });

  const imageAttachment = useImageAttachment(dropTargetId);

  // Pull stable function references out of the imageAttachment object so the
  // effects below only re-run when draftSessionId changes, not on every render
  // (useImageAttachment returns a new object literal each call).
  const { restoreImages, images: attachmentImages } = imageAttachment;

  useInputAreaImageDraft({ draftSessionId, restoreImages, attachmentImages });

  const { programmaticInputMutationDepthRef, withProgrammaticInputMutation } =
    useProgrammaticInputMutation();

  const handleRestoreInputContent = useCallback(
    (text: string) => {
      refs.setHasContent(text.trim().length > 0);
      handleSessInputChange(text);
    },
    [handleSessInputChange, refs]
  );

  const uploadContext = useUploadContext({
    composerInputRef: refs.composerInputRef,
    imageOwnerId: dropTargetId,
  });

  const dragDrop = useDragDrop({
    composerInputRef: refs.composerInputRef,
  });

  const promptPolish = usePromptPolish({
    refs,
    draftSessionId,
    setDraft,
    handleSessInputChange,
    withProgrammaticInputMutation,
  });
  const handlePromptPolishContentChange = promptPolish.handleContentChange;

  // ============================================
  // Effects
  // ============================================

  useInputAreaEffects({
    composerInputRef: refs.composerInputRef,
    containerRef: refs.containerRef,
    dropTargetId,
    hasContentRef: refs.hasContentRef,
    showContextMenu: state.showContextMenu,
    setShowContextMenu: state.setShowContextMenu,
    isCiteCode: citeCode.isCiteCode,
    selectedCiteText: citeCode.selectedCiteText,
    selectedCiteRange: citeCode.selectedCiteRange,
    citeFileName: citeCode.citeFileName,
    currentRepoPath,
    withProgrammaticInputMutation,
    onRestoreInputContent: handleRestoreInputContent,
  });

  // ============================================
  // Event Handlers - Input Management
  // ============================================

  const {
    handleInputBlur,
    handleContentChange,
    compactHintVisible,
    canvasHintVisible,
  } = useInputAreaContentChange({
    refs,
    state,
    activeSessionId,
    draftSessionId,
    enableAgentInterceptors,
    handleSessInputChange,
    handlePromptPolishContentChange,
    setDraft,
    programmaticInputMutationDepthRef,
  });

  useInputAreaDraftRestore({
    refs,
    draftSessionId,
    persistedDraft,
    mentionMenuOpen: state.showSlashMenu || state.showContextMenu,
  });

  const isInputEmpty = useCallback(() => {
    return refs.composerInputRef.current?.isEmpty() ?? true;
  }, [refs.composerInputRef]);

  // ============================================
  // Event Handlers - Message Submission
  // ============================================

  const handleDivSubmit = useSubmitMessage({
    refs,
    draftSessionId,
    replyTargetEventId,
    flushDraft,
    clearReplyTarget,
    imageAttachment,
    citeCode,
    handleSessChatSubmit,
    onSubmitOverride,
    submitDisabled,
    enableAgentInterceptors,
  });

  // ============================================
  // Return Interface
  // ============================================

  return {
    // Refs
    composerInputRef: refs.composerInputRef,
    containerRef: refs.containerRef,
    contextMenuKeyboardHandlerRef: refs.contextMenuKeyboardHandlerRef,
    slashCommandKeyboardHandlerRef: refs.slashCommandKeyboardHandlerRef,
    hasContentRef: refs.hasContentRef,

    // Input state
    isInputFocused: state.isInputFocused,
    setIsInputFocused: state.setIsInputFocused,
    handleInputBlur,
    handleContentChange,
    compactHintVisible:
      compactHintVisible && activeSession?.cliAgentType !== "codex",
    canvasHintVisible,
    handleAtMention: atMention.handleAtMention,
    handleAtMentionClose: atMention.handleAtMentionClose,
    isInputEmpty,
    promptPolish,

    // @ Mention
    showContextMenu: state.showContextMenu,
    setShowContextMenu: state.setShowContextMenu,
    atSearchQuery: state.atSearchQuery,
    setAtSearchQuery: state.setAtSearchQuery,
    handleAtSelect: atMention.handleAtSelect,
    handleCustomMentionSelect: atMention.handleCustomMentionSelect,
    customMentionOptions: mergedCustomMentionOptions,

    // Slash command
    showSlashMenu: state.showSlashMenu,
    slashQuery: state.slashQuery,
    handleSlashCommand: slashCommand.handleSlashCommand,
    handleSlashCommandClose: slashCommand.handleSlashCommandClose,
    handleSlashSelect: slashCommand.handleSlashSelect,
    handleModeSelect: slashCommand.handleModeSelect,
    currentMode: slashCommand.currentMode,
    includeProjectMode: slashCommand.includeProjectMode,
    filteredSlashItems: slashCommand.filteredItems,
    slashLoading: slashCommand.slashLoading,

    // File selection
    handleSelectFile: fileSelection.handleSelectFile,

    // Context management
    contextItemsAtChat: fileSelection.contextItemsAtChat,
    setContextItemsAtChat: fileSelection.setContextItemsAtChat,
    // Upload
    fileInputRef: uploadContext.fileInputRef,
    handleUploadClick: uploadContext.handleUploadClick,
    handleFileUpload: uploadContext.handleFileUpload,

    // Cite code
    isCiteCode: citeCode.isCiteCode,
    selectedCiteRange: citeCode.selectedCiteRange,
    selectedCiteText: citeCode.selectedCiteText,
    citeFileName: citeCode.citeFileName,
    clearCiteCode: citeCode.clearCiteCode,

    // Message submission
    handleDivSubmit,
    isWpGeneWorking,
    isSessionActive,
    isPendingCancel,
    wpReadOnly,

    // Session control — stopSession triggers interrupt and primes the
    // silent-queue window (isPendingCancelAtom) so subsequent user input
    // is enqueued invisibly until Rust finishes winding the turn down.
    interruptSession: stopSession,
    resumeSession,
    isHosted,
    canStopAgent,
    canResume,
    isSessionTerminal,

    // Drag & drop
    dropTargetId,
    handleDragOver: dragDrop.handleDragOver,
    handleDragLeave: dragDrop.handleDragLeave,
    handleDrop: dragDrop.handleDrop,

    // Styling
    isDark,

    // Context hooks
    feedBack,
    setFeedBack: setFeedBack as (info: unknown) => void,
    replyInfo: effectiveReplyInfo,
    setReplyInfo: setReplyInfoBridge as (info: unknown) => void,
    localContextList,
    currentRepoPath,
    skillWorkspacePaths,

    // Image attachments
    attachedImages: imageAttachment.images,
    handleImagePaste: imageAttachment.handleImagePaste,
    hasImages: imageAttachment.hasImages,
    clearAttachedImages: imageAttachment.clearImages,
  };
}

export default useInputArea;
