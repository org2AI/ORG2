import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type AgentOrgRunView,
  type AgentOrgTask,
  requestAgentOrgTaskHandoff,
  resolveAgentOrgTaskHandoff,
} from "@src/api/tauri/agent";
import Message from "@src/components/Message";

import {
  type HandoffResolutionDialogState,
  type TaskActionDialogState,
  logger,
} from "./agentOrgOverviewPanelShared";

interface UseAgentOrgTaskHandoffDialogsOptions {
  currentSessionId: string;
  currentRunId: string | null;
  runStatus: AgentOrgRunView["runStatus"] | undefined;
  members: AgentOrgRunView["context"]["members"] | undefined;
  onRefresh: () => Promise<void>;
}

export function useAgentOrgTaskHandoffDialogs({
  currentSessionId,
  currentRunId,
  runStatus,
  members,
  onRefresh,
}: UseAgentOrgTaskHandoffDialogsOptions) {
  const { t } = useTranslation("sessions");
  const [taskActionDialog, setTaskActionDialog] =
    useState<TaskActionDialogState | null>(null);
  const [selectedReplacementOwner, setSelectedReplacementOwner] = useState("");
  const [handoffResolutionDialog, setHandoffResolutionDialog] =
    useState<HandoffResolutionDialogState | null>(null);
  const [isMutatingTask, setIsMutatingTask] = useState(false);

  useEffect(() => {
    setTaskActionDialog(null);
    setHandoffResolutionDialog(null);
    setSelectedReplacementOwner("");
  }, [currentRunId, currentSessionId, runStatus]);

  const openTaskAction = useCallback(
    (task: AgentOrgTask, action: "cancel" | "reassign") => {
      setTaskActionDialog({ task, action });
      setSelectedReplacementOwner(task.owner ?? members?.[0]?.memberId ?? "");
    },
    [members]
  );

  const handleTaskAction = useCallback(async () => {
    if (!taskActionDialog || isMutatingTask) return;
    if (taskActionDialog.action === "reassign" && !selectedReplacementOwner) {
      return;
    }
    setIsMutatingTask(true);
    try {
      await requestAgentOrgTaskHandoff({
        sessionId: currentSessionId,
        requestId: crypto.randomUUID(),
        taskId: taskActionDialog.task.id,
        action: taskActionDialog.action,
        replacementOwnerMemberId:
          taskActionDialog.action === "reassign"
            ? selectedReplacementOwner
            : null,
      });
      setTaskActionDialog(null);
      await onRefresh();
    } catch (taskError) {
      logger.error("Failed to update Agent Team Task:", taskError);
      Message.error(t("planner.agentOrgTasks.handoffFailed"));
    } finally {
      setIsMutatingTask(false);
    }
  }, [
    currentSessionId,
    isMutatingTask,
    onRefresh,
    selectedReplacementOwner,
    t,
    taskActionDialog,
  ]);

  const handleHandoffResolution = useCallback(async () => {
    if (!handoffResolutionDialog || isMutatingTask) return;
    setIsMutatingTask(true);
    try {
      await resolveAgentOrgTaskHandoff({
        sessionId: currentSessionId,
        requestId: crypto.randomUUID(),
        receiptId: handoffResolutionDialog.receipt.id,
        resolution: handoffResolutionDialog.resolution,
      });
      setHandoffResolutionDialog(null);
      await onRefresh();
    } catch (resolutionError) {
      logger.error(
        "Failed to resolve Agent Team Task handoff:",
        resolutionError
      );
      Message.error(t("planner.agentOrgTasks.handoffResolutionFailed"));
    } finally {
      setIsMutatingTask(false);
    }
  }, [currentSessionId, handoffResolutionDialog, isMutatingTask, onRefresh, t]);

  return {
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
  };
}
