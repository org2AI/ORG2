import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { SidebarRow } from "@src/components/SidebarRow";
import SessionHoverCard from "@src/features/SessionHoverCard";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import type { FileSessionHistoryParticipant } from "../types";
import { FileSessionHistoryIcon } from "./FileSessionHistoryIcon";

interface FileSessionHistoryParticipantProps {
  participant: FileSessionHistoryParticipant;
  originSessionId: string;
  source: string;
  onClick?: () => void;
}

export const FileSessionHistoryParticipantView: React.FC<FileSessionHistoryParticipantProps> =
  memo(({ participant, originSessionId, source, onClick }) => {
    const { t } = useTranslation();
    const actionSummary = Object.entries(participant.actionCounts)
      .filter(([, count]) => count > 0)
      .map(
        ([action, count]) =>
          `${t(`labels.sessionBlameAction.${action}`, { defaultValue: action })} ${count}`
      )
      .join(" · ");
    const meta = [
      formatRelativeTime(participant.lastInteractionAt, "compact"),
      actionSummary,
    ].filter(Boolean);
    const attribution =
      participant.participantKind === "subagent"
        ? t("labels.sessionBlameSubagent", {
            name:
              participant.actorLabel ??
              participant.actorId ??
              participant.sessionLabel,
          })
        : t("labels.sessionBlameMainSession");
    const precision = t(
      `labels.sessionBlamePrecision.${participant.attributionPrecision}`
    );
    const hasTranscript = Boolean(participant.transcriptSessionId);

    const row = (
      <SidebarRow
        data-testid="session-blame-entry"
        data-session-id={participant.sessionId}
        data-transcript-session-id={
          participant.transcriptSessionId ?? undefined
        }
        data-origin-session-id={originSessionId}
        data-participant-kind={participant.participantKind}
        data-actor-id={participant.actorId ?? undefined}
        data-session-source={source}
        data-attribution-precision={participant.attributionPrecision}
        data-read-count={participant.actionCounts.read ?? 0}
        data-write-count={participant.actionCounts.write ?? 0}
        onClick={onClick}
        disabled={!hasTranscript}
        title={`${participant.sessionLabel} · ${attribution} · ${precision}`}
        label={participant.sessionLabel}
        metadata={meta.join(" · ")}
        indented
        icon={
          <FileSessionHistoryIcon
            sessionId={participant.transcriptSessionId ?? participant.sessionId}
          />
        }
      >
        <span data-testid="session-blame-attribution">
          {attribution} · {precision}
        </span>
      </SidebarRow>
    );

    return hasTranscript ? (
      <SessionHoverCard
        sessionId={participant.transcriptSessionId}
        position="right-start"
        mouseEnterDelay={600}
      >
        {row}
      </SessionHoverCard>
    ) : (
      row
    );
  });

FileSessionHistoryParticipantView.displayName =
  "FileSessionHistoryParticipantView";
