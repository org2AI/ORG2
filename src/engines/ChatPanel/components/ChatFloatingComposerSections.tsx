import type { TFunction } from "i18next";
import React from "react";

import Button from "@src/components/Button";
import { PILL_CONTROL_IDLE_SURFACE_CLASS } from "@src/components/CompoundPill/config";
import { COMPOSER_STACK_INSET_X_CLASS } from "@src/config/composerStackTokens";
import {
  ChatRetryBanner,
  toChatRetryKind,
} from "@src/engines/ChatPanel/components/ChatStatusBanners";
import { ArrowDown02Icon, HugeiconsIcon } from "@src/icons";
import type { PendingPlanApproval } from "@src/store/session/planApprovalAtom";

import type { ScrollNavState } from "../ChatHistory";
import AskQuestionCard from "../InputArea/AskQuestionCard";
import { ModeSwitchInputCard } from "../InputArea/ModeSwitchCard";
import PermissionCard from "../InputArea/PermissionCard";
import ActiveProcesses from "../InputArea/components/ActiveProcesses";
import AgentOrgInterventionPinBar from "../InputArea/components/AgentOrgInterventionPinBar";
import CompactFileChanges, {
  type FileChangeVisibleStats,
} from "../InputArea/components/CompactFileChanges";
import CreatePlanCard from "../blocks/CreatePlanCard";
import type {
  AgentOrgInterventionView,
  GroupChatPendingMessageView,
  StreamRetryInfo,
} from "../chatFloatingComposerTypes";

interface ComposerScrollToBottomButtonProps {
  scrollNav: ScrollNavState;
  t: TFunction<"sessions">;
}

/** Top-row trailing button that returns history to the bottom. */
export const ComposerScrollToBottomButton: React.FC<
  ComposerScrollToBottomButtonProps
> = ({ scrollNav, t }) => (
  <Button
    size="small"
    shape="round"
    icon={
      <HugeiconsIcon icon={ArrowDown02Icon} data-icon="arrow-down" size={14} />
    }
    iconOnly
    data-testid="chat-scroll-to-bottom"
    aria-label={t("common:inbox.scrollToBottom")}
    title={t("common:inbox.scrollToBottom")}
    onClick={scrollNav.onScrollToBottom}
    className={`shrink-0 ${PILL_CONTROL_IDLE_SURFACE_CLASS}`}
  />
);

interface ComposerInteractionCardsProps {
  sessionId: string;
  currentPlanApproval: PendingPlanApproval | null | undefined;
  shouldShowCurrentPlanSurface: boolean;
  currentPlanSurfaceState: Parameters<typeof CreatePlanCard>[0]["surfaceState"];
  planCollapsed: boolean;
  onPlanCollapse: () => void;
  questionCollapsed: boolean;
  permissionCollapsed: boolean;
  onQuestionCollapse: () => void;
  onPermissionCollapse: () => void;
  onQuestionDataChange: (hasData: boolean) => void;
  onPermissionDataChange: (hasData: boolean) => void;
  onModeSwitchDataChange: (hasData: boolean) => void;
}

/** Current plan, ask-question and permission cards, then the mode-switch tracker. */
export const ComposerInteractionCards: React.FC<
  ComposerInteractionCardsProps
> = ({
  sessionId,
  currentPlanApproval,
  shouldShowCurrentPlanSurface,
  currentPlanSurfaceState,
  planCollapsed,
  onPlanCollapse,
  questionCollapsed,
  permissionCollapsed,
  onQuestionCollapse,
  onPermissionCollapse,
  onQuestionDataChange,
  onPermissionDataChange,
  onModeSwitchDataChange,
}) => (
  <>
    {currentPlanApproval && shouldShowCurrentPlanSurface && (
      // The plan card uses the chat-history block shell; inset it here so it
      // lines up with the rest of the composer stack.
      <div className={COMPOSER_STACK_INSET_X_CLASS}>
        <CreatePlanCard
          key={`current-plan-${currentPlanApproval.planRevisionId ?? currentPlanApproval.toolCallId ?? currentPlanApproval.planPath}`}
          content={currentPlanApproval.planContent}
          title={currentPlanApproval.planTitle}
          isStreaming={false}
          toolCallId={currentPlanApproval.toolCallId}
          planId={currentPlanApproval.planId}
          planRevisionId={currentPlanApproval.planRevisionId}
          sessionId={sessionId}
          surface="current"
          surfaceState={currentPlanSurfaceState}
          collapsed={planCollapsed}
          onCollapse={onPlanCollapse}
        />
      </div>
    )}

    <AskQuestionCard
      key={`ask-${sessionId}`}
      collapsed={questionCollapsed}
      onCollapse={onQuestionCollapse}
      onHasDataChange={onQuestionDataChange}
    />
    <PermissionCard
      key={`permission-${sessionId}`}
      sessionId={sessionId}
      collapsed={permissionCollapsed}
      onCollapse={onPermissionCollapse}
      onHasDataChange={onPermissionDataChange}
    />
    <ModeSwitchInputCard
      key={`mode-switch-tracker-${sessionId}`}
      collapsed
      onHasDataChange={onModeSwitchDataChange}
    />
  </>
);

interface ComposerActivityTrackersProps {
  sessionId: string;
  inputAreaSessionId: string;
  processExpanded: boolean;
  onToggleProcess: () => void;
  onProcessVisibleCountChange: (count: number) => void;
  /** False when the host already resolved the files-pill stats. */
  trackFileChanges: boolean;
  filesReloadKey: string;
  onFileChangeStatsChange: (next: FileChangeVisibleStats) => void;
}

/** Active processes (expanded or hidden tracker) and the file-change tracker. */
export const ComposerActivityTrackers: React.FC<
  ComposerActivityTrackersProps
> = ({
  sessionId,
  inputAreaSessionId,
  processExpanded,
  onToggleProcess,
  onProcessVisibleCountChange,
  trackFileChanges,
  filesReloadKey,
  onFileChangeStatsChange,
}) => (
  <>
    {processExpanded && (
      <ActiveProcesses
        key={`process-expanded-${sessionId}`}
        sessionId={sessionId}
        onToggle={onToggleProcess}
        onVisibleCountChange={onProcessVisibleCountChange}
      />
    )}
    {!processExpanded && (
      <ActiveProcesses
        key={`process-hidden-${sessionId}`}
        sessionId={sessionId}
        onToggle={onToggleProcess}
        onVisibleCountChange={onProcessVisibleCountChange}
        hidden
      />
    )}
    {trackFileChanges && (
      <CompactFileChanges
        key={`files-tracker-${inputAreaSessionId}`}
        sessionIdOverride={inputAreaSessionId}
        reloadKey={filesReloadKey}
        onVisibleStatsChange={onFileChangeStatsChange}
      />
    )}
  </>
);

interface GroupChatPendingMessagePillProps {
  groupChatPendingMessage: GroupChatPendingMessageView;
  t: TFunction<"sessions">;
}

/** Delivery status of the user's last group-chat message, with a retry when unknown. */
export const GroupChatPendingMessagePill: React.FC<
  GroupChatPendingMessagePillProps
> = ({ groupChatPendingMessage, t }) => (
  <div
    data-testid="agent-org-group-chat-pending"
    data-target-name={groupChatPendingMessage.targetMemberName}
    data-delivery-state={
      groupChatPendingMessage.retryError ? "unknown" : "pending"
    }
    className="bg-background-2 mx-auto flex items-center gap-2 rounded-full border border-solid border-border-2 px-3 py-1 text-[12px] text-text-2 shadow-xs"
  >
    {groupChatPendingMessage.retryError ? (
      <>
        <span className="h-1.5 w-1.5 rounded-full bg-warning-6" />
        <span>{t("groupChat.userMessageOutcomeUnknown")}</span>
        <Button
          data-testid="agent-org-group-chat-retry"
          size="mini"
          shape="round"
          loading={groupChatPendingMessage.retrying}
          disabled={groupChatPendingMessage.retrying}
          onClick={() => void groupChatPendingMessage.onRetry()}
        >
          {t("common:actions.retry")}
        </Button>
      </>
    ) : (
      <>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-6" />
        <span>
          {t("groupChat.userMessagePending", {
            member: groupChatPendingMessage.targetMemberName,
          })}
        </span>
      </>
    )}
  </div>
);

interface ComposerStatusBannersProps {
  sessionId: string;
  hasModeSwitch: boolean;
  modeSwitchCollapsed: boolean;
  onModeSwitchCollapse: () => void;
  agentOrgIntervention: AgentOrgInterventionView | null;
  streamRetry: StreamRetryInfo | null;
  groupChatPausedBottomContent: React.ReactNode;
}

/** Banners stacked above the composer: mode switch, org intervention, stream retry, paused group chat. */
export const ComposerStatusBanners: React.FC<ComposerStatusBannersProps> = ({
  sessionId,
  hasModeSwitch,
  modeSwitchCollapsed,
  onModeSwitchCollapse,
  agentOrgIntervention,
  streamRetry,
  groupChatPausedBottomContent,
}) => (
  <>
    {hasModeSwitch && !modeSwitchCollapsed && (
      <ModeSwitchInputCard
        key={`mode-switch-status-${sessionId}`}
        collapsed={false}
        onCollapse={onModeSwitchCollapse}
      />
    )}
    {agentOrgIntervention && (
      <AgentOrgInterventionPinBar
        intervention={agentOrgIntervention.intervention}
        member={agentOrgIntervention.member}
        runStatus={agentOrgIntervention.runStatus}
        error={agentOrgIntervention.error}
        returning={agentOrgIntervention.returning}
        stopping={agentOrgIntervention.stopping}
        onReturnToWork={agentOrgIntervention.onReturnToWork}
        onStopUserDirectedWork={agentOrgIntervention.onStopUserDirectedWork}
      />
    )}
    {streamRetry && (
      <ChatRetryBanner
        kind={toChatRetryKind(streamRetry.kind)}
        attempt={streamRetry.attempt}
        maxAttempts={streamRetry.maxAttempts}
      />
    )}
    {groupChatPausedBottomContent}
  </>
);
