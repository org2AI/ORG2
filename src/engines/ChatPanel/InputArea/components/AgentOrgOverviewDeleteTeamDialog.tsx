import React from "react";
import { useTranslation } from "react-i18next";

import Checkbox from "@src/components/Checkbox";
import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import Modal from "@src/scaffold/ModalSystem";

interface AgentOrgOverviewDeleteTeamDialogProps {
  visible: boolean;
  deleteConfirmed: boolean;
  onDeleteConfirmedChange: (checked: boolean) => void;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const AgentOrgOverviewDeleteTeamDialog: React.FC<
  AgentOrgOverviewDeleteTeamDialogProps
> = ({
  visible,
  deleteConfirmed,
  onDeleteConfirmedChange,
  isDeleting,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <Modal
      visible={visible}
      title={t("planner.agentOrgOverview.deleteTitle", {
        defaultValue: "Permanently delete this Team?",
      })}
      // Modal portals to document.body; keep it inside Overview's
      // document-level outside-click boundary for real pointer events.
      className="agent-org-overview-owned-overlay"
      width={420}
      maskClosable={!isDeleting}
      closable={!isDeleting}
      onCancel={onClose}
      bodyClassName="space-y-3 p-3"
      footer={
        <PanelFooter
          secondaryActions={[
            {
              label: t("common:actions.cancel"),
              onClick: onClose,
              disabled: isDeleting,
            },
          ]}
          primaryAction={{
            label: t("planner.agentOrgOverview.deleteTeam", {
              defaultValue: "Delete Team",
            }),
            onClick: () => void onConfirm(),
            tone: "danger",
            disabled: !deleteConfirmed || isDeleting,
            loading: isDeleting,
            dataTestId: "agent-org-delete-confirm-button",
          }}
        />
      }
    >
      <div
        className="border-error-6/25 bg-error-6/5 rounded-md border px-3 py-2 text-[12px] leading-5 text-text-2"
        role="alert"
      >
        {t("planner.agentOrgOverview.deleteWarning", {
          defaultValue:
            "This permanently deletes every Team session and its history. This action cannot be undone.",
        })}
      </div>
      <Checkbox
        checked={deleteConfirmed}
        disabled={isDeleting}
        onCheckedChange={onDeleteConfirmedChange}
      >
        {t("planner.agentOrgOverview.deleteAcknowledge", {
          defaultValue: "I understand this deletion is permanent.",
        })}
      </Checkbox>
    </Modal>
  );
};

export default AgentOrgOverviewDeleteTeamDialog;
