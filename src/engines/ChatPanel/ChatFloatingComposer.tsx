import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionFollowUpSuggestion } from "@src/api/services/sessionFollowUpSuggestions";
import {
  COMPOSER_BOTTOM_DOCK_PADDING_CLASS,
  COMPOSER_HORIZONTAL_GUTTER_CLASS,
} from "@src/config/composerStackTokens";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import type { PendingPlanApproval } from "@src/store/session/planApprovalAtom";

import type { ScrollNavState } from "./ChatHistory";
import InputArea from "./InputArea";
import CollapsedInlineRow, {
  type InlineSection,
} from "./InputArea/components/CollapsedInlineRow";
import type { FileChangeVisibleStats } from "./InputArea/components/CompactFileChanges";
import QueueEditModeCard from "./InputArea/components/QueueEditModeCard";
import QueuedMessages from "./InputArea/components/QueuedMessages";
import { createFileInlineSection } from "./InputArea/hooks/useComposerSections";
import type { QueueEditInputAreaProps } from "./InputArea/hooks/useQueueEditMode";
import type CreatePlanCard from "./blocks/CreatePlanCard";
import type {
  AgentOrgInterventionView,
  CanvasPreviewPillView,
  GroupChatPendingMessageView,
  StreamRetryInfo,
} from "./chatFloatingComposerTypes";
import {
  ComposerActivityTrackers,
  ComposerInteractionCards,
  ComposerScrollToBottomButton,
  ComposerStatusBanners,
  GroupChatPendingMessagePill,
} from "./components/ChatFloatingComposerSections";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "./hooks/useInputArea/types";

interface ChatFloatingComposerProps {
  composerRef: React.Ref<HTMLDivElement>;
  inputBoxRef?: React.Ref<HTMLDivElement>;
  sessionId: string;
  inputAreaSessionId: string;
  controlSessionId?: string | null;
  currentPlanApproval: PendingPlanApproval | null | undefined;
  shouldShowCurrentPlanSurface: boolean;
  currentPlanSurfaceState: Parameters<typeof CreatePlanCard>[0]["surfaceState"];
  planCollapsed: boolean;
  onPlanCollapse: () => void;
  questionCollapsed: boolean;
  permissionCollapsed: boolean;
  modeSwitchCollapsed: boolean;
  onQuestionCollapse: () => void;
  onPermissionCollapse: () => void;
  onModeSwitchCollapse: () => void;
  onQuestionDataChange: (hasData: boolean) => void;
  onPermissionDataChange: (hasData: boolean) => void;
  onModeSwitchDataChange: (hasData: boolean) => void;
  processExpanded: boolean;
  queuedMessages: Parameters<typeof QueuedMessages>[0]["messages"];
  onCancelQueuedMessage: Parameters<typeof QueuedMessages>[0]["onCancel"];
  onSendQueuedMessageNow: Parameters<typeof QueuedMessages>[0]["onSendNow"];
  onReorderQueuedMessages: Parameters<typeof QueuedMessages>[0]["onReorder"];
  onToggleProcess: () => void;
  onProcessVisibleCountChange: (count: number) => void;
  onFilesExpand: () => void;
  filesMenu?: React.ReactNode;
  /** Host-resolved files-pill stats; when set no artifact tracker mounts. */
  resolvedFileChangeStats?: FileChangeVisibleStats;
  /** Idle-reload signal for the files pill (session/round/idle transitions). */
  filesReloadKey: string;
  groupChatPendingMessage: GroupChatPendingMessageView | null;
  groupChatViewActive: boolean;
  hasAnyInlineSection: boolean;
  scrollNav: ScrollNavState | null;
  canvasPreview: CanvasPreviewPillView | null;
  inlineSections: InlineSection[];
  hasModeSwitch: boolean;
  agentOrgIntervention: AgentOrgInterventionView | null;
  streamRetry: StreamRetryInfo | null;
  groupChatPausedBottomContent: React.ReactNode;
  onSubmitOverride: (input: SubmitOverrideInput) => Promise<boolean>;
  customMentionOptions: ReadonlyArray<CustomMentionOption>;
  queueEditProps: QueueEditInputAreaProps;
  disableStopWhenEmpty?: boolean;
  followUpSuggestions: ReadonlyArray<SessionFollowUpSuggestion>;
  onFollowUpSuggestionSent: () => void;
  submitDisabled?: boolean;
}

const ChatFloatingComposer: React.FC<ChatFloatingComposerProps> = memo(
  ({
    composerRef,
    inputBoxRef,
    sessionId,
    inputAreaSessionId,
    controlSessionId,
    currentPlanApproval,
    shouldShowCurrentPlanSurface,
    currentPlanSurfaceState,
    planCollapsed,
    onPlanCollapse,
    questionCollapsed,
    permissionCollapsed,
    modeSwitchCollapsed,
    onQuestionCollapse,
    onPermissionCollapse,
    onModeSwitchCollapse,
    onQuestionDataChange,
    onPermissionDataChange,
    onModeSwitchDataChange,
    processExpanded,
    queuedMessages,
    onCancelQueuedMessage,
    onSendQueuedMessageNow,
    onReorderQueuedMessages,
    onToggleProcess,
    onProcessVisibleCountChange,
    onFilesExpand,
    filesMenu,
    resolvedFileChangeStats,
    filesReloadKey,
    groupChatPendingMessage,
    groupChatViewActive,
    hasAnyInlineSection,
    scrollNav,
    canvasPreview,
    inlineSections,
    hasModeSwitch,
    agentOrgIntervention,
    streamRetry,
    groupChatPausedBottomContent,
    onSubmitOverride,
    customMentionOptions,
    queueEditProps,
    disableStopWhenEmpty = false,
    followUpSuggestions,
    onFollowUpSuggestionSent,
    submitDisabled = false,
  }) => {
    const { t } = useTranslation("sessions");
    const [fileChangeStats, setFileChangeStatsState] =
      useState<FileChangeVisibleStats>({
        count: 0,
        additions: 0,
        deletions: 0,
      });
    const [prevInputAreaSessionId, setPrevInputAreaSessionId] =
      useState(inputAreaSessionId);
    if (inputAreaSessionId !== prevInputAreaSessionId) {
      setPrevInputAreaSessionId(inputAreaSessionId);
      setFileChangeStatsState({ count: 0, additions: 0, deletions: 0 });
    }
    const setFileChangeStats = useCallback((next: FileChangeVisibleStats) => {
      setFileChangeStatsState((current) =>
        current.count === next.count &&
        current.additions === next.additions &&
        current.deletions === next.deletions
          ? current
          : next
      );
    }, []);

    // Host-resolved stats render in the same commit; tracker-reported stats
    // arrive one effect later.
    const visibleFileChangeStats = resolvedFileChangeStats ?? fileChangeStats;

    const localInlineSections = useMemo<InlineSection[]>(() => {
      const fileSection = createFileInlineSection({
        fileChangeStats: visibleFileChangeStats,
        onFilesExpand,
        filesMenu,
      });
      return fileSection ? [...inlineSections, fileSection] : inlineSections;
    }, [visibleFileChangeStats, filesMenu, inlineSections, onFilesExpand]);

    const hasLocalInlineSection =
      hasAnyInlineSection || visibleFileChangeStats.count > 0;
    const showTopRowPills =
      hasLocalInlineSection ||
      scrollNav?.showFollowAgent ||
      scrollNav?.showAddToConversation ||
      canvasPreview;
    const trailingScrollButton = scrollNav?.showScrollToBottom ? (
      <ComposerScrollToBottomButton scrollNav={scrollNav} t={t} />
    ) : null;

    return (
      <div
        ref={composerRef}
        className={`pointer-events-none absolute right-0 bottom-0 left-0 z-50 flex w-full shrink-0 flex-col items-center pt-1 ${COMPOSER_HORIZONTAL_GUTTER_CLASS} ${COMPOSER_BOTTOM_DOCK_PADDING_CLASS}`}
      >
        {/* Let wheel/trackpad input over the glow and gutters reach history. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[-28px] bottom-0 bg-linear-to-t from-chat-pane via-chat-pane/90 to-transparent"
        />
        <div
          className={`pointer-events-auto relative z-10 flex w-full flex-col gap-1.5 ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
        >
          <ComposerInteractionCards
            sessionId={sessionId}
            currentPlanApproval={currentPlanApproval}
            shouldShowCurrentPlanSurface={shouldShowCurrentPlanSurface}
            currentPlanSurfaceState={currentPlanSurfaceState}
            planCollapsed={planCollapsed}
            onPlanCollapse={onPlanCollapse}
            questionCollapsed={questionCollapsed}
            permissionCollapsed={permissionCollapsed}
            onQuestionCollapse={onQuestionCollapse}
            onPermissionCollapse={onPermissionCollapse}
            onQuestionDataChange={onQuestionDataChange}
            onPermissionDataChange={onPermissionDataChange}
            onModeSwitchDataChange={onModeSwitchDataChange}
          />

          <ComposerActivityTrackers
            sessionId={sessionId}
            inputAreaSessionId={inputAreaSessionId}
            processExpanded={processExpanded}
            onToggleProcess={onToggleProcess}
            onProcessVisibleCountChange={onProcessVisibleCountChange}
            trackFileChanges={!resolvedFileChangeStats}
            filesReloadKey={filesReloadKey}
            onFileChangeStatsChange={setFileChangeStats}
          />

          <QueueEditModeCard />
          {groupChatPendingMessage && groupChatViewActive && (
            <GroupChatPendingMessagePill
              groupChatPendingMessage={groupChatPendingMessage}
              t={t}
            />
          )}

          <InputArea
            omitChatHeader
            sessionId={inputAreaSessionId}
            controlSessionId={controlSessionId}
            onSubmitOverride={onSubmitOverride}
            customMentionOptions={customMentionOptions}
            submitDisabled={submitDisabled}
            topRowPills={
              showTopRowPills ? (
                <CollapsedInlineRow
                  sections={localInlineSections}
                  scrollNav={scrollNav}
                  canvasPreview={canvasPreview}
                />
              ) : null
            }
            topRowTrailingContent={trailingScrollButton}
            composerTray={
              <QueuedMessages
                messages={queuedMessages}
                onCancel={onCancelQueuedMessage}
                onSendNow={onSendQueuedMessageNow}
                onReorder={onReorderQueuedMessages}
              />
            }
            statusBanners={
              <ComposerStatusBanners
                sessionId={sessionId}
                hasModeSwitch={hasModeSwitch}
                modeSwitchCollapsed={modeSwitchCollapsed}
                onModeSwitchCollapse={onModeSwitchCollapse}
                agentOrgIntervention={agentOrgIntervention}
                streamRetry={streamRetry}
                groupChatPausedBottomContent={groupChatPausedBottomContent}
              />
            }
            followUpSuggestions={followUpSuggestions}
            onFollowUpSuggestionSent={onFollowUpSuggestionSent}
            composerShellRef={inputBoxRef}
            disableStopWhenEmpty={disableStopWhenEmpty}
            {...queueEditProps}
          />
        </div>
      </div>
    );
  }
);

ChatFloatingComposer.displayName = "ChatFloatingComposer";

export default ChatFloatingComposer;
