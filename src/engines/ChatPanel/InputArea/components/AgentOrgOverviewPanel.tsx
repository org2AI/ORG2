import { useSetAtom } from "jotai";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AGENT_ORG_TASK_STATUS,
  type AgentOrgRunView,
} from "@src/api/tauri/agent";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import { HierarchyCircle01Icon, HugeiconsIcon } from "@src/icons";
import { activeSessionIdAtom } from "@src/store/session";

import AgentOrgFinalSummaryCard from "./AgentOrgFinalSummaryCard";
import AgentOrgOverviewArchivedSections from "./AgentOrgOverviewArchivedSections";
import AgentOrgOverviewCurrentWorkSection from "./AgentOrgOverviewCurrentWorkSection";
import AgentOrgOverviewDeleteTeamDialog from "./AgentOrgOverviewDeleteTeamDialog";
import AgentOrgOverviewHeaderActions from "./AgentOrgOverviewHeaderActions";
import AgentOrgOverviewMemberActivity from "./AgentOrgOverviewMemberActivity";
import AgentOrgOverviewPrimaryBadge from "./AgentOrgOverviewPrimaryBadge";
import OverviewSectionToggle from "./AgentOrgOverviewSectionToggle";
import AgentOrgOverviewStats from "./AgentOrgOverviewStats";
import {
  AgentOrgOverviewHandoffResolutionDialog,
  AgentOrgOverviewTaskActionDialog,
} from "./AgentOrgOverviewTaskDialogs";
import AgentOrgOverviewTaskHistorySection from "./AgentOrgOverviewTaskHistorySection";
import AgentOrgPlanApprovalCard from "./AgentOrgPlanApprovalCard";
import ComposerStackHeader from "./ComposerStackHeader";
import { useAgentOrgOverviewPresentation } from "./useAgentOrgOverviewPresentation";
import { useAgentOrgOverviewRunControls } from "./useAgentOrgOverviewRunControls";
import { useAgentOrgTaskHandoffDialogs } from "./useAgentOrgTaskHandoffDialogs";
import { useAgentOrgTaskHistory } from "./useAgentOrgTaskHistory";
import { useAgentOrgTeamDeletion } from "./useAgentOrgTeamDeletion";

interface AgentOrgOverviewPanelProps {
  view: AgentOrgRunView | null;
  error: string | null;
  currentSessionId: string;
  onRefresh: () => Promise<void>;
}

const AgentOrgOverviewPanel: React.FC<AgentOrgOverviewPanelProps> = memo(
  ({ view, error, currentSessionId, onRefresh }) => {
    const { t } = useTranslation("sessions");
    const [expanded, setExpanded] = useState(true);
    const [planHistoryExpanded, setPlanHistoryExpanded] = useState(true);
    const [currentWorkExpanded, setCurrentWorkExpanded] = useState(true);
    const currentRunId = view?.context.runId ?? null;
    const pendingPlanRevisionIds =
      view?.planRevisions
        .filter((revision) => revision.status === "pending")
        .map((revision) => revision.approvalId) ?? [];
    const pendingPlanRevisionSignature = pendingPlanRevisionIds.join("\u0000");
    const teamPresentationIdentity = `${currentSessionId}\u0000${currentRunId ?? ""}`;
    const previousPendingPlanRevisionIdsRef = useRef<Set<string>>(new Set());

    const {
      isRunning,
      isPaused,
      isArchived,
      canArchive,
      runPhaseLabel,
      completionBadgeClass,
      coordinatorWorkStateLabel,
    } = useAgentOrgOverviewPresentation(view);

    const {
      isTogglingPause,
      isArchiving,
      handlePauseRun,
      handleResumeRun,
      handleArchiveRun,
    } = useAgentOrgOverviewRunControls({
      currentSessionId,
      onRefresh,
      canArchive,
      isRunning,
    });

    const {
      deleteModalOpen,
      setDeleteModalOpen,
      deleteConfirmed,
      setDeleteConfirmed,
      isDeleting,
      closeDeleteModal,
      handleDeleteTeam,
    } = useAgentOrgTeamDeletion({
      currentSessionId,
      currentRunId,
      runStatus: view?.runStatus,
      rootSessionId: view?.context.rootSessionId,
    });

    const {
      taskActionDialog,
      setTaskActionDialog,
      selectedReplacementOwner,
      setSelectedReplacementOwner,
      handoffResolutionDialog,
      setHandoffResolutionDialog,
      isMutatingTask,
      openTaskAction,
      handleTaskAction,
      handleHandoffResolution,
    } = useAgentOrgTaskHandoffDialogs({
      currentSessionId,
      currentRunId,
      runStatus: view?.runStatus,
      members: view?.context.members,
      onRefresh,
    });

    const {
      historyExpanded,
      historyStatus,
      historyPage,
      historyLoading,
      historyError,
      loadHistoryPage,
      handleHistoryToggle,
      handleHistoryStatus,
    } = useAgentOrgTaskHistory({
      currentSessionId,
      currentRunId,
      runStatus: view?.runStatus,
    });

    useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-expand both sections whenever the Team presentation identity changes
      setPlanHistoryExpanded(true);
      setCurrentWorkExpanded(true);
      // Section expansion belongs to a Team presentation, not a run phase.
    }, [teamPresentationIdentity]);

    useEffect(() => {
      const pendingIds = pendingPlanRevisionSignature
        ? pendingPlanRevisionSignature.split("\u0000")
        : [];
      const nextPendingIds = new Set(pendingIds);
      if (
        pendingIds.some(
          (approvalId) =>
            !previousPendingPlanRevisionIdsRef.current.has(approvalId)
        )
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a newly pending plan revision must re-open the plan history section
        setPlanHistoryExpanded(true);
      }
      previousPendingPlanRevisionIdsRef.current = nextPendingIds;
      // The signature makes this effect react to approval identity changes,
      // while still allowing a user to collapse an unchanged pending plan.
    }, [pendingPlanRevisionSignature]);
    const handleRefresh = useCallback(() => onRefresh(), [onRefresh]);
    const { spinClass, handleClick: handleRefreshClick } = useRefreshSpin(
      handleRefresh,
      false
    );
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);

    const rootSessionId = view?.context.rootSessionId;
    const isViewingCoordinatorSession =
      rootSessionId != null && currentSessionId === rootSessionId;
    const canNavigateToCoordinator =
      rootSessionId != null && !isViewingCoordinatorSession;

    const handleNavigateToCoordinator = useCallback(() => {
      if (rootSessionId) {
        setActiveSessionId(rootSessionId);
      }
    }, [rootSessionId, setActiveSessionId]);

    if (!view && !error) return null;

    const completedTasks = view?.taskOverview.completed ?? 0;
    const totalTasks = view?.taskOverview.total ?? 0;
    const activeMembers = view?.workState.activeMembers ?? 0;
    const membersWithDirectActivity =
      view?.members.filter((member) => member.activity != null) ?? [];
    const pendingMessages = view?.workState.blockingInbox ?? 0;
    const planRevisions = view?.planRevisions ?? [];
    const blockedCurrentTaskCount =
      view?.tasks.filter(
        (task) =>
          task.status === AGENT_ORG_TASK_STATUS.PENDING &&
          task.dependenciesSatisfied === false
      ).length ?? 0;
    const activeHandoffs = (view?.executionHandoffs ?? []).filter(
      (receipt) => receipt.resolution == null && receipt.state !== "released"
    );
    const canManageTasks =
      view?.context.rootSessionId === currentSessionId && isRunning;

    return (
      <div
        data-testid="agent-org-overview-panel"
        data-agent-org-overview-panel="true"
        data-run-id={view?.context.runId ?? ""}
        data-run-phase={view?.runPhase ?? ""}
        className="min-w-0"
      >
        <ComposerStackHeader
          label={view?.context.orgName ?? t("planner.agentOrgOverview.title")}
          icon={
            <HugeiconsIcon
              icon={HierarchyCircle01Icon}
              data-icon="network"
              size={13}
              strokeWidth={1.75}
              className="text-text-3"
            />
          }
          expanded={expanded}
          onToggle={() => setExpanded((previous) => !previous)}
          badges={
            <AgentOrgOverviewPrimaryBadge
              view={view}
              error={error}
              runPhaseLabel={runPhaseLabel}
              completionBadgeClass={completionBadgeClass}
            />
          }
          actions={
            <AgentOrgOverviewHeaderActions
              canNavigateToCoordinator={canNavigateToCoordinator}
              onNavigateToCoordinator={handleNavigateToCoordinator}
              isRunning={isRunning}
              isPaused={isPaused}
              isTogglingPause={isTogglingPause}
              onPauseRun={handlePauseRun}
              onResumeRun={handleResumeRun}
              canArchive={canArchive}
              isArchiving={isArchiving}
              onArchiveRun={handleArchiveRun}
              onRefreshClick={handleRefreshClick}
              refreshSpinClass={spinClass}
            />
          }
        />

        {!error && view && (
          <div
            className="flex min-w-0 items-center gap-2 px-2.5 pb-1.5 pl-[30px] text-[10px] text-text-3"
            data-testid="agent-org-overview-secondary-status"
          >
            {coordinatorWorkStateLabel && (
              <span
                className="min-w-0 flex-1 truncate"
                data-testid="agent-org-coordinator-work-state"
                data-coordinator-work-state={view.coordinatorWorkState}
                title={coordinatorWorkStateLabel}
              >
                {coordinatorWorkStateLabel}
              </span>
            )}
            <span className="shrink-0 font-medium tabular-nums">
              {t("planner.agentOrgOverview.summary", {
                active: activeMembers,
                pending: pendingMessages,
              })}
            </span>
          </div>
        )}

        {expanded && view && (
          <div
            className="space-y-2 px-2 pb-2"
            data-testid="agent-org-overview-body"
          >
            <AgentOrgOverviewStats
              view={view}
              completedTasks={completedTasks}
              totalTasks={totalTasks}
              activeMembers={activeMembers}
              pendingMessages={pendingMessages}
            />

            {view.finalSummary?.status === "failed" ? (
              <AgentOrgFinalSummaryCard
                receipt={view.finalSummary}
                sessionId={currentSessionId}
                onRetried={onRefresh}
              />
            ) : null}

            {planRevisions.length > 0 ? (
              <div className="space-y-2" data-testid="agent-org-plan-approvals">
                <OverviewSectionToggle
                  expanded={planHistoryExpanded}
                  label={t(
                    "planner.agentOrgOverview.planApproval.historyTitle"
                  )}
                  count={planRevisions.length}
                  onToggle={() =>
                    setPlanHistoryExpanded((previous) => !previous)
                  }
                  testId="agent-org-plan-history-toggle"
                />
                {planHistoryExpanded &&
                  planRevisions.map((approval) => (
                    <AgentOrgPlanApprovalCard
                      key={approval.approvalId}
                      approval={approval}
                      sourceMemberName={
                        view.members.find(
                          (member) =>
                            member.memberId === approval.sourceMemberId
                        )?.name ?? approval.sourceMemberId
                      }
                      disabled={!isRunning}
                      onResolved={onRefresh}
                    />
                  ))}
              </div>
            ) : null}

            {membersWithDirectActivity.length > 0 && (
              <AgentOrgOverviewMemberActivity
                members={membersWithDirectActivity}
              />
            )}

            <AgentOrgOverviewCurrentWorkSection
              view={view}
              currentSessionId={currentSessionId}
              expanded={currentWorkExpanded}
              onToggle={() => setCurrentWorkExpanded((previous) => !previous)}
              blockedCurrentTaskCount={blockedCurrentTaskCount}
              activeHandoffs={activeHandoffs}
              awaitingApprovalTaskIds={planRevisions
                .filter((revision) => revision.status === "pending")
                .map((revision) => revision.sourceTaskId)}
              canManageTasks={canManageTasks}
              onRequestResolution={setHandoffResolutionDialog}
              onTaskAction={openTaskAction}
            />

            <AgentOrgOverviewTaskHistorySection
              view={view}
              currentSessionId={currentSessionId}
              historyExpanded={historyExpanded}
              historyStatus={historyStatus}
              historyPage={historyPage}
              historyLoading={historyLoading}
              historyError={historyError}
              onHistoryToggle={handleHistoryToggle}
              onHistoryStatus={handleHistoryStatus}
              loadHistoryPage={loadHistoryPage}
            />

            {isArchived && (
              <AgentOrgOverviewArchivedSections
                view={view}
                onRequestDelete={() => setDeleteModalOpen(true)}
              />
            )}
          </div>
        )}

        <AgentOrgOverviewTaskActionDialog
          taskActionDialog={taskActionDialog}
          members={view?.context.members}
          selectedReplacementOwner={selectedReplacementOwner}
          onSelectReplacementOwner={setSelectedReplacementOwner}
          isMutatingTask={isMutatingTask}
          onClose={() => setTaskActionDialog(null)}
          onConfirm={handleTaskAction}
        />

        <AgentOrgOverviewHandoffResolutionDialog
          handoffResolutionDialog={handoffResolutionDialog}
          isMutatingTask={isMutatingTask}
          onClose={() => setHandoffResolutionDialog(null)}
          onConfirm={handleHandoffResolution}
        />

        <AgentOrgOverviewDeleteTeamDialog
          visible={deleteModalOpen}
          deleteConfirmed={deleteConfirmed}
          onDeleteConfirmedChange={setDeleteConfirmed}
          isDeleting={isDeleting}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteTeam}
        />
      </div>
    );
  }
);

AgentOrgOverviewPanel.displayName = "AgentOrgOverviewPanel";

export default AgentOrgOverviewPanel;
