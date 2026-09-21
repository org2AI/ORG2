import { useAtom, useAtomValue } from "jotai";
import { type MutableRefObject, useContext, useEffect, useMemo } from "react";

import type {
  ComposerInputRef,
  ComposerSnapshot,
} from "@src/components/ComposerInput";
import { useConversationExecutionBinding } from "@src/engines/ChatPanel/ConversationExecutionBindingContext";
import { ChatPanelFullScreenContext } from "@src/engines/ChatPanel/chatPanelFullScreenContext";
import { useInputArea } from "@src/engines/ChatPanel/hooks/useInputArea";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "@src/engines/ChatPanel/hooks/useInputArea/types";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import {
  useConversationComposerMode,
  useConversationSubmitOverride,
} from "@src/features/Org2Cloud/SessionConversation/useConversationComposer";
import { voiceInputEnabledAtom } from "@src/store/platform/voiceInputAtom";
import {
  compactComposerInputAtom,
  pinnedActionsVisibleAtom,
} from "@src/store/session";
import type { SlashItemCategory } from "@src/types/extensions";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import { usePinnedActionsVisibilityContextMenu } from "../components/PinnedActionsBar/usePinnedActionsVisibilityContextMenu";
import { getComposerPills } from "../composerPills";
import {
  type InputAreaPresentation,
  isContextualInputAreaPresentation,
  shouldUseCompactComposerLayout,
} from "../inputAreaPresentation";
import { useContainerDrag } from "./useContainerDrag";
import { useEditMode } from "./useEditMode";
import { useEditorExpansion } from "./useEditorExpansion";
import { useInputAreaComposerActions } from "./useInputAreaComposerActions";
import { useInputAreaMentionOptions } from "./useInputAreaMentionOptions";
import { useInputAreaMenus } from "./useInputAreaMenus";
import { useInputAreaVoice } from "./useInputAreaVoice";

interface UseInputAreaInteractiveModelOptions {
  isEditMode: boolean;
  initialContent: string | undefined;
  onEditSubmit:
    | ((
        text: string,
        imageDataUrls?: string[],
        composerSnapshot?: ComposerSnapshot
      ) => void)
    | undefined;
  onEditSendNow: ((text: string, imageDataUrls?: string[]) => void) | undefined;
  onEditCancel: (() => void) | undefined;
  propSessionId: string | undefined;
  controlSessionId: string | null | undefined;
  onSubmitOverride:
    | ((input: SubmitOverrideInput) => Promise<boolean>)
    | undefined;
  customMentionOptions: ReadonlyArray<CustomMentionOption> | undefined;
  onFollowUpSuggestionSent: (() => void) | undefined;
  externalComposerInputRef:
    | MutableRefObject<ComposerInputRef | null>
    | undefined;
  acceptDraggedPills: boolean;
  disableStopWhenEmpty: boolean;
  submitDisabled: boolean;
  sessionScope: "active" | "none";
  showAgentControls: boolean;
  enableAgentInterceptors: boolean;
  slashItemCategories: ReadonlyArray<SlashItemCategory> | undefined;
  presentation: InputAreaPresentation;
}

export function useInputAreaInteractiveModel({
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
}: UseInputAreaInteractiveModelOptions) {
  const conversationExecutionBinding = useConversationExecutionBinding();

  const { sessionId } = useSessionId({ propSessionId });
  const isCursorIde = sessionId ? isCursorIdeSession(sessionId) : false;
  const conversationSubmitOverride = useConversationSubmitOverride(
    sessionId ?? null,
    onSubmitOverride
  );
  const [conversationMode] = useConversationComposerMode(sessionId ?? null);
  const teamChatActive = conversationMode === "team_chat";

  const mergedCustomMentionOptions = useInputAreaMentionOptions({
    customMentionOptions,
    teamChatActive,
  });

  const inputArea = useInputArea({
    sessionId: propSessionId,
    controlSessionId,
    sessionScope,
    submitDisabled,
    onSubmitOverride: conversationSubmitOverride,
    customMentionOptions: mergedCustomMentionOptions,
    // Team Chat is a human comment surface. It keeps shared composer
    // validation/attachments, but Agent-only slash commands, pending
    // questions, MCP prompts, and skill expansion must not mutate or consume
    // the backing Agent transcript before the comment router sees the text.
    enableAgentInterceptors: enableAgentInterceptors && !teamChatActive,
    executionControlsEnabled: !teamChatActive,
  });
  const {
    composerInputRef,
    containerRef,
    setShowContextMenu,
    setAtSearchQuery,
    handleAtMention,
    isInputEmpty,
    handleModeSelect,
    filteredSlashItems,
    handleUploadClick,
    handleDivSubmit,
    isWpGeneWorking,
    canResume,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setReplyInfo,
    attachedImages,
    hasImages,
    clearAttachedImages,
    isCiteCode,
    replyInfo,
    handleContentChange,
  } = inputArea;

  const currentTextEmpty = isInputEmpty();
  const currentInputEmpty = currentTextEmpty && !hasImages;
  // Canonical conversations own resume/retry through the canonical queue;
  // the generic CLI Resume action would target the hidden runner directly.
  const genericResumeAvailable =
    canResume && !teamChatActive && conversationExecutionBinding === null;
  const stopSuppressedForEmptyInput =
    disableStopWhenEmpty && currentInputEmpty && !isWpGeneWorking;
  const voiceFeatureEnabled = useAtomValue(voiceInputEnabledAtom);
  const [pinnedActionsVisible, setPinnedActionsVisible] = useAtom(
    pinnedActionsVisibleAtom
  );
  const handlePinnedActionsContextMenu = usePinnedActionsVisibilityContextMenu({
    visible: pinnedActionsVisible,
    onVisibleChange: setPinnedActionsVisible,
  });
  const isContextualPanel = presentation === "contextual";
  const isContextual = isContextualInputAreaPresentation(presentation);

  const compactInputEnabled = useAtomValue(compactComposerInputAtom);
  const chatPanelFullScreen = useContext(ChatPanelFullScreenContext);
  const compactLayoutInput = {
    compactInputEnabled,
    chatPanelFullScreen,
    isEditMode,
    hasImages,
    isCiteCode,
    isReply: replyInfo.isReply,
  };
  const { editorMultiline, onEditorContentChange } = useEditorExpansion({
    enabled: compactInputEnabled && chatPanelFullScreen && !isEditMode,
    compactEligible: shouldUseCompactComposerLayout({
      ...compactLayoutInput,
      editorMultiline: false,
    }),
    containerRef,
    handleContentChange,
  });
  const isCompactRow = shouldUseCompactComposerLayout({
    ...compactLayoutInput,
    editorMultiline,
  });

  const {
    handleOpenContextMenu,
    handleContextMenuClose,
    handleKeyboardAtMention,
  } = useInputAreaMenus({
    composerInputRef,
    setShowContextMenu,
    setAtSearchQuery,
    handleAtMention,
  });

  const attachedImageDataUrls = attachedImages.map((image) => image.dataUrl);
  const { editContainerRef, handleEditSubmit, handleEditKeyDown } = useEditMode(
    {
      effectiveEditMode: isEditMode,
      isEditMode,
      initialContent,
      onEditSubmit,
      attachedImageDataUrls,
      clearAttachedImages,
      onEditCancel,
      composerInputRef,
    }
  );

  const {
    handleContextModeSelect,
    handleContextImageUpload,
    handleEditSendNow,
    clearReplyInfo,
    submitMessage,
    submitFollowUpSuggestion,
  } = useInputAreaComposerActions({
    composerInputRef,
    handleModeSelect,
    handleContextMenuClose,
    handleUploadClick,
    onEditSendNow,
    attachedImageDataUrls,
    clearAttachedImages,
    setReplyInfo,
    handleDivSubmit,
    onFollowUpSuggestionSent,
  });

  const {
    handleContainerDragOver,
    handleContainerDragLeave,
    handleContainerDrop,
    isDragOver,
  } = useContainerDrag({
    handleDragOver,
    handleDragLeave,
    handleDrop,
    composerInputRef,
    containerRef,
    acceptDraggedPills,
  });

  // Republish the editor handle to an external owner. No dependency array:
  // the handle is created by `ComposerInput`'s own `useImperativeHandle`, so
  // re-mirroring after every render is what keeps a stale object from being
  // handed to a drop target that fires much later.
  useEffect(() => {
    if (!externalComposerInputRef) return undefined;
    externalComposerInputRef.current = composerInputRef.current;
    return () => {
      externalComposerInputRef.current = null;
    };
  });

  const { voice, showVoiceUi } = useInputAreaVoice({
    composerInputRef,
    containerRef,
    enabled: showAgentControls && voiceFeatureEnabled,
    isEditMode,
  });

  const visibleSlashItems = useMemo(
    () =>
      slashItemCategories
        ? filteredSlashItems.filter((item) =>
            slashItemCategories.includes(item.category)
          )
        : filteredSlashItems,
    [filteredSlashItems, slashItemCategories]
  );

  const { modelPill, modePill } = getComposerPills({
    showAgentControls,
    teamChatActive,
    isCursorIde,
    sessionId,
  });

  return {
    ...inputArea,
    sessionId,
    isCursorIde,
    teamChatActive,
    currentTextEmpty,
    currentInputEmpty,
    genericResumeAvailable,
    stopSuppressedForEmptyInput,
    voiceFeatureEnabled,
    pinnedActionsVisible,
    handlePinnedActionsContextMenu,
    isContextualPanel,
    isContextual,
    isCompactRow,
    onEditorContentChange,
    handleOpenContextMenu,
    handleContextMenuClose,
    handleKeyboardAtMention,
    editContainerRef,
    handleEditSubmit,
    handleEditKeyDown,
    handleContextModeSelect,
    handleContextImageUpload,
    handleEditSendNow,
    clearReplyInfo,
    submitMessage,
    submitFollowUpSuggestion,
    handleContainerDragOver,
    handleContainerDragLeave,
    handleContainerDrop,
    isDragOver,
    voice,
    showVoiceUi,
    visibleSlashItems,
    modelPill,
    modePill,
  };
}

export type InputAreaInteractiveModel = ReturnType<
  typeof useInputAreaInteractiveModel
>;
