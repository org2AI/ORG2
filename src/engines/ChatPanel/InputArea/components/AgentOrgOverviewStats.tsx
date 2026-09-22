import React from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunView } from "@src/api/tauri/agent";
import {
  CheckmarkCircle01Icon,
  HugeiconsIcon,
  InboxIcon,
  UserCircleIcon,
} from "@src/icons";

interface AgentOrgOverviewStatsProps {
  view: AgentOrgRunView;
  completedTasks: number;
  totalTasks: number;
  activeMembers: number;
  pendingMessages: number;
}

const AgentOrgOverviewStats: React.FC<AgentOrgOverviewStatsProps> = ({
  view,
  completedTasks,
  totalTasks,
  activeMembers,
  pendingMessages,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 text-[11px] text-text-3">
        <div className="rounded-md bg-bg-1 px-2 py-1.5">
          <div className="flex items-center gap-1 text-text-2">
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              data-icon="check-circle-2"
              size={11}
              strokeWidth={2}
            />
            {t("planner.agentOrgOverview.tasks")}
          </div>
          <div className="mt-0.5 font-medium text-text-1">
            {t("planner.agentOrgOverview.doneOf", {
              done: completedTasks,
              total: totalTasks,
            })}
          </div>
        </div>
        <div className="rounded-md bg-bg-1 px-2 py-1.5">
          <div className="flex items-center gap-1 text-text-2">
            <HugeiconsIcon
              icon={UserCircleIcon}
              data-icon="user-round"
              size={11}
              strokeWidth={2}
            />
            {t("planner.agentOrgOverview.members")}
          </div>
          <div className="mt-0.5 font-medium text-text-1">
            {t("planner.agentOrgOverview.activeOf", {
              active: activeMembers,
              total: view.members.length,
            })}
          </div>
        </div>
        <div className="rounded-md bg-bg-1 px-2 py-1.5">
          <div className="flex items-center gap-1 text-text-2">
            <HugeiconsIcon
              icon={InboxIcon}
              data-icon="inbox"
              size={11}
              strokeWidth={2}
            />
            {t("planner.agentOrgOverview.inbox")}
          </div>
          <div
            className="mt-0.5 font-medium text-text-1"
            data-testid="agent-org-overview-inbox-count"
            data-pending-inbox-count={pendingMessages}
          >
            {t("planner.agentOrgOverview.pendingInboxCount", {
              count: pendingMessages,
            })}
          </div>
        </div>
      </div>

      <div
        className="grid grid-cols-4 gap-1 text-[10px] text-text-3"
        data-testid="agent-org-work-state"
      >
        {(
          [
            [
              "activeMembers",
              t("planner.agentOrgOverview.activeMembers"),
              view.workState.activeMembers,
            ],
            [
              "inFlightTurns",
              t("planner.agentOrgOverview.inFlightTurns"),
              view.workState.inFlightTurns,
            ],
            [
              "openTasks",
              t("planner.agentOrgOverview.openTasks"),
              view.workState.openTasks,
            ],
            [
              "blockingInbox",
              t("planner.agentOrgOverview.blockingInbox"),
              view.workState.blockingInbox,
            ],
          ] as const
        ).map(([kind, label, count]) => (
          <div
            key={kind}
            className="min-w-0 rounded-md bg-bg-1 px-1.5 py-1"
            data-work-state-kind={kind}
            data-work-state-count={count}
          >
            <div className="truncate" title={label}>
              {label}
            </div>
            <div className="font-medium text-text-1 tabular-nums">{count}</div>
          </div>
        ))}
      </div>
    </>
  );
};

export default AgentOrgOverviewStats;
