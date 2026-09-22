import React from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunView } from "@src/api/tauri/agent";
import Select from "@src/components/Select";
import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import Modal from "@src/scaffold/ModalSystem";

import type {
  HandoffResolutionDialogState,
  TaskActionDialogState,
} from "./agentOrgOverviewPanelShared";

interface AgentOrgOverviewTaskActionDialogProps {
  taskActionDialog: TaskActionDialogState | null;
  members: AgentOrgRunView["context"]["members"] | undefined;
  selectedReplacementOwner: string;
  onSelectReplacementOwner: (owner: string) => void;
  isMutatingTask: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const AgentOrgOverviewTaskActionDialog: React.FC<
  AgentOrgOverviewTaskActionDialogProps
> = ({
  taskActionDialog,
  members,
  selectedReplacementOwner,
  onSelectReplacementOwner,
  isMutatingTask,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <Modal
      visible={taskActionDialog !== null}
      title={
        taskActionDialog?.action === "reassign"
          ? t("planner.agentOrgTasks.reassignTitle")
          : t("planner.agentOrgTasks.cancelTitle")
      }
      className="agent-org-overview-owned-overlay"
      width={420}
      maskClosable={!isMutatingTask}
      closable={!isMutatingTask}
      onCancel={() => !isMutatingTask && onClose()}
      bodyClassName="space-y-3 p-3"
      footer={
        <PanelFooter
          secondaryActions={[
            {
              label: t("common:actions.cancel"),
              onClick: onClose,
              disabled: isMutatingTask,
            },
          ]}
          primaryAction={{
            label:
              taskActionDialog?.action === "reassign"
                ? t("planner.agentOrgTasks.reassign")
                : t("planner.agentOrgTasks.cancelTask"),
            onClick: () => void onConfirm(),
            tone: taskActionDialog?.action === "cancel" ? "danger" : undefined,
            disabled:
              isMutatingTask ||
              (taskActionDialog?.action === "reassign" &&
                !selectedReplacementOwner),
            loading: isMutatingTask,
            dataTestId: "agent-org-task-handoff-confirm-button",
          }}
        />
      }
    >
      <div className="text-[12px] leading-5 text-text-2">
        {taskActionDialog?.action === "reassign"
          ? t("planner.agentOrgTasks.reassignWarning")
          : t("planner.agentOrgTasks.cancelWarning")}
      </div>
      {taskActionDialog?.action === "reassign" && (
        <div className="space-y-1 text-[11px] text-text-2">
          <div>{t("planner.agentOrgTasks.replacementOwner")}</div>
          <Select
            value={selectedReplacementOwner}
            disabled={isMutatingTask}
            onChange={(value) => onSelectReplacementOwner(String(value))}
            options={(members ?? []).map((member) => ({
              value: member.memberId,
              label: `${member.name} · ${member.role}`,
              dataTestId: `agent-org-task-reassign-owner-option-${member.memberId}`,
            }))}
            className="w-full"
            panelClassName="agent-org-overview-owned-overlay"
            panelZIndex={10010}
            placement="auto"
            dataTestId="agent-org-task-reassign-owner-select"
            ariaLabel={t("planner.agentOrgTasks.replacementOwner")}
          />
        </div>
      )}
    </Modal>
  );
};

interface AgentOrgOverviewHandoffResolutionDialogProps {
  handoffResolutionDialog: HandoffResolutionDialogState | null;
  isMutatingTask: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const AgentOrgOverviewHandoffResolutionDialog: React.FC<
  AgentOrgOverviewHandoffResolutionDialogProps
> = ({ handoffResolutionDialog, isMutatingTask, onClose, onConfirm }) => {
  const { t } = useTranslation("sessions");
  return (
    <Modal
      visible={handoffResolutionDialog !== null}
      title={t("planner.agentOrgTasks.resolveHandoffTitle")}
      className="agent-org-overview-owned-overlay"
      width={440}
      maskClosable={!isMutatingTask}
      closable={!isMutatingTask}
      onCancel={() => !isMutatingTask && onClose()}
      bodyClassName="space-y-3 p-3"
      footer={
        <PanelFooter
          secondaryActions={[
            {
              label: t("common:actions.cancel"),
              onClick: onClose,
              disabled: isMutatingTask,
            },
          ]}
          primaryAction={{
            label:
              handoffResolutionDialog?.resolution === "continue_replacement"
                ? t("planner.agentOrgTasks.continueReplacement")
                : handoffResolutionDialog?.resolution === "keep_stopped"
                  ? t("planner.agentOrgTasks.keepStopped")
                  : t("planner.agentOrgTasks.abandonEpisode"),
            onClick: () => void onConfirm(),
            tone:
              handoffResolutionDialog?.resolution === "abandon_episode"
                ? "danger"
                : undefined,
            disabled:
              isMutatingTask ||
              (handoffResolutionDialog?.resolution === "continue_replacement" &&
                handoffResolutionDialog.receipt.localEffectCount !== 0),
            loading: isMutatingTask,
            dataTestId: "agent-org-handoff-resolution-confirm-button",
          }}
        />
      }
    >
      <div
        className="rounded-md border border-warning-6/25 bg-warning-6/5 px-3 py-2 text-[12px] leading-5 text-text-2"
        role="alert"
      >
        {handoffResolutionDialog?.resolution === "continue_replacement"
          ? t("planner.agentOrgTasks.continueWarning")
          : handoffResolutionDialog?.resolution === "keep_stopped"
            ? t("planner.agentOrgTasks.keepStoppedWarning")
            : t("planner.agentOrgTasks.abandonWarning")}
      </div>
    </Modal>
  );
};
