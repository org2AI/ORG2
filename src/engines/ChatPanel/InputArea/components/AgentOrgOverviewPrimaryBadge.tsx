import React from "react";
import { useTranslation } from "react-i18next";

import {
  AGENT_ORG_RUN_PHASE,
  type AgentOrgRunView,
} from "@src/api/tauri/agent";
import { CancelCircleIcon, HugeiconsIcon, Refresh04Icon } from "@src/icons";

interface AgentOrgOverviewPrimaryBadgeProps {
  view: AgentOrgRunView | null;
  error: string | null;
  runPhaseLabel: string | null;
  completionBadgeClass: string;
}

const AgentOrgOverviewPrimaryBadge: React.FC<
  AgentOrgOverviewPrimaryBadgeProps
> = ({ view, error, runPhaseLabel, completionBadgeClass }) => {
  const { t } = useTranslation("sessions");
  return error ? (
    <span className="text-error-6 ml-1 inline-flex items-center gap-1 text-[13px] font-medium">
      <HugeiconsIcon
        icon={CancelCircleIcon}
        data-icon="xcircle"
        size={11}
        strokeWidth={2}
      />
      {t("planner.agentOrgOverview.loadFailed")}
    </span>
  ) : (
    <div className="flex min-w-0 items-center gap-1">
      {runPhaseLabel && (
        <span
          className={`inline-flex max-w-48 min-w-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${completionBadgeClass}`}
          data-testid="agent-org-overview-run-phase"
          data-run-phase={view?.runPhase ?? ""}
          data-completion-state={view?.completion?.state ?? "none"}
          data-completion-outcome={view?.completion?.outcome ?? ""}
          title={runPhaseLabel}
        >
          {(view?.runPhase === AGENT_ORG_RUN_PHASE.FINALIZING ||
            view?.runPhase === AGENT_ORG_RUN_PHASE.DRAINING) && (
            <HugeiconsIcon
              icon={Refresh04Icon}
              data-icon="refresh-cw"
              size={9}
              strokeWidth={2}
              className="mr-1 inline-block animate-spin motion-reduce:animate-none"
            />
          )}
          <span className="truncate">{runPhaseLabel}</span>
        </span>
      )}
    </div>
  );
};

export default AgentOrgOverviewPrimaryBadge;
