import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import ActionCard from "@src/components/ActionCard";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { ProcessStopButton } from "@src/components/ProcessStopButton";
import {
  TYPOGRAPHY,
  WORKSTATION_TRAIL_CONTENT,
} from "@src/config/workstation/tokens";
import type { SubagentSession } from "@src/contracts/simulator/subagent";
import {
  stopSubagentJobAtom,
  stoppingSubagentJobsAtom,
} from "@src/store/session/stopSubagentJobAtom";
import { formatDuration } from "@src/util/time/formatDuration";

const SUBAGENT_STATUSES = new Set([
  "pending",
  "idle",
  "running",
  "waiting_for_user",
  "waiting_for_funds",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "abandoned",
  "timeout",
  "archived",
  "killed",
  "unknown",
]);

function elapsed(session: SubagentSession, now: number) {
  const end = session.isTerminal ? session.endedAtMs : now;
  if (
    end == null ||
    !Number.isFinite(session.startedAtMs) ||
    !Number.isFinite(end)
  )
    return null;
  return formatDuration(Math.max(0, end - session.startedAtMs));
}

export function SubagentTrailCard({
  session,
  parentSessionId,
  now,
  taskTitle,
  canStop,
  onView,
}: {
  session: SubagentSession;
  parentSessionId: string;
  now: number;
  taskTitle?: string;
  canStop: boolean;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const stop = useSetAtom(stopSubagentJobAtom);
  const stopping = useAtomValue(stoppingSubagentJobsAtom).has(
    session.sessionId
  );
  const [stopError, setStopError] = useState(false);
  const title = session.description || taskTitle || session.name;
  const rawStatus = session.rawStatus ?? session.status;
  const statusKey = `sessions:subagentTrail.status.${SUBAGENT_STATUSES.has(rawStatus) ? rawStatus : "unknown"}`;
  const duration = elapsed(session, now);
  return (
    <article data-subagent-card={session.sessionId} className="mx-1">
      <ActionCard
        title={title}
        truncateTitle
        variant="activity"
        description={`${t(statusKey)}${duration ? ` · ${duration}` : ""}`}
        onClick={onView}
        trailingAction={
          canStop && !session.isTerminal ? (
            <ToolbarTooltip label={t("common:actions.stop")} noShortcut>
              <ProcessStopButton
                size="sm"
                label={`${t("common:actions.stop")} ${title}`}
                title={t("common:actions.stop")}
                loading={stopping}
                onClick={async () => {
                  setStopError(false);
                  try {
                    await stop({ parentSessionId, handle: session.sessionId });
                  } catch {
                    setStopError(true);
                  }
                }}
              />
            </ToolbarTooltip>
          ) : undefined
        }
      />
      {stopError && (
        <p
          role="alert"
          className={`${WORKSTATION_TRAIL_CONTENT.rowHorizontalPadding} ${TYPOGRAPHY.secondary} text-danger-6`}
        >
          {t("sessions:subagentTrail.stopError")}
        </p>
      )}
    </article>
  );
}
