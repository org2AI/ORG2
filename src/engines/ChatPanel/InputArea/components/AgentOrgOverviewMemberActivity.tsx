import React from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunView } from "@src/api/tauri/agent";
import { AgentOrgWriterBadge } from "@src/engines/ChatPanel/blocks/OrgTaskBadges";
import { Activity01Icon, HugeiconsIcon } from "@src/icons";

interface AgentOrgOverviewMemberActivityProps {
  members: AgentOrgRunView["members"];
}

const AgentOrgOverviewMemberActivity: React.FC<
  AgentOrgOverviewMemberActivityProps
> = ({ members }) => {
  const { t } = useTranslation("sessions");
  return (
    <div className="space-y-1" data-testid="agent-org-overview-member-activity">
      <div className="mb-1 flex items-center gap-1 px-1 text-[11px] font-medium text-text-2">
        <HugeiconsIcon
          icon={Activity01Icon}
          data-icon="activity"
          size={11}
          strokeWidth={2}
        />
        <span>{t("planner.agentOrgOverview.directActivity")}</span>
      </div>
      {members.map((member) => (
        <div
          key={`${member.memberId}:${member.activity?.interventionReceiptId}`}
          className="flex min-w-0 items-center gap-2 rounded-md bg-bg-1 px-2 py-1.5 text-[11px]"
          data-testid={`agent-org-overview-member-activity-${member.memberId}`}
          data-activity-kind={member.activity?.kind}
          data-activity-source={member.activity?.source}
          data-intervention-receipt-id={member.activity?.interventionReceiptId}
        >
          <span className="min-w-0 flex-1 truncate font-medium text-text-1">
            {member.name}
          </span>
          {member.writerCapable && !member.isCoordinator && (
            <AgentOrgWriterBadge>
              {t("planner.agentOrgIntervention.writerBadge")}
            </AgentOrgWriterBadge>
          )}
          <span className="shrink-0 text-text-3">
            {t(
              `planner.agentOrgIntervention.activity.${member.activity?.kind}`,
              { count: member.queuedUserDirectedCount }
            )}
          </span>
        </div>
      ))}
    </div>
  );
};

export default AgentOrgOverviewMemberActivity;
