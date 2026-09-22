/**
 * SessionHoverCardContent — row presenters.
 *
 * The rows with real markup of their own: agent + model, repo · branch,
 * underlying id / storage path, and agent activity. Single-line metadata
 * rows stay inline in `SessionHoverCardContent`.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { HoverCardRow } from "@src/components/HoverCard/HoverCardBase";
import {
  HoverCardMetadataRow,
  HoverCardMetadataValue,
} from "@src/components/HoverCard/HoverCardMetadataRow";
import { HOVER_CARD } from "@src/components/HoverCard/tokens";
import ModelIcon from "@src/components/ModelIcon";
import {
  FingerPrintIcon,
  FloppyDiskIcon,
  GripIcon,
  HugeiconsIcon,
  Tick01Icon,
  Timer01Icon,
  WorkflowCircle05Icon,
} from "@src/icons";

import {
  type AgentSessionInfo,
  INLINE_LINK_CLASS_NAME,
  PATH_ROW_CLASS_NAME,
  REVEAL_ICON_BUTTON_CLASS_NAME,
  formatCompactPath,
  handleRevealPath,
} from "./sessionHoverCardContentHelpers";
import { formatCompactSessionId } from "./sessionIdFormat";
import type { SessionTurnOverview } from "./useSessionTurnOverview";

// ── Agent + model ─────────────────────────────────────────────────────────────

interface SessionHoverCardAgentRowProps {
  agentSessionInfo: AgentSessionInfo;
  modelLabel: string | null;
  modelTitle: string | null | undefined;
  modelIconName: string | undefined;
  modelIconAgent: React.ComponentProps<typeof ModelIcon>["agentType"];
}

export const SessionHoverCardAgentRow: React.FC<
  SessionHoverCardAgentRowProps
> = ({
  agentSessionInfo,
  modelLabel,
  modelTitle,
  modelIconName,
  modelIconAgent,
}) => (
  <HoverCardRow
    icon={agentSessionInfo.icon}
    iconClassName={agentSessionInfo.textClassName}
  >
    <div
      className={`flex min-w-0 items-center truncate ${agentSessionInfo.textClassName ?? "text-text-2"}`}
      title={
        modelTitle ? `${agentSessionInfo.label} · ${modelTitle}` : undefined
      }
    >
      <span className="truncate">{agentSessionInfo.label}</span>
      {modelLabel && (
        <>
          <span className="mx-1 text-text-4">·</span>
          <span className="mr-1 flex shrink-0 items-center">
            {modelIconName ? (
              <ModelIcon
                modelName={modelIconName}
                agentType={modelIconAgent}
                size={HOVER_CARD.iconSize}
              />
            ) : (
              <HugeiconsIcon
                icon={GripIcon}
                data-icon="grip"
                size={HOVER_CARD.iconSize}
                strokeWidth={HOVER_CARD.iconStrokeWidth}
              />
            )}
          </span>
          <span className="truncate">{modelLabel}</span>
        </>
      )}
    </div>
  </HoverCardRow>
);

// ── Repo · branch ─────────────────────────────────────────────────────────────

interface SessionHoverCardRepoBranchRowProps {
  repoName: string;
  repoPath: string | undefined;
  branchLabel: string;
  revealLabel: string;
}

export const SessionHoverCardRepoBranchRow: React.FC<
  SessionHoverCardRepoBranchRowProps
> = ({ repoName, repoPath, branchLabel, revealLabel }) => (
  <HoverCardMetadataRow icon={WorkflowCircle05Icon} dataIcon="git-branch">
    <div
      className="flex min-w-0 items-center text-text-2"
      data-testid="session-hover-repo-branch"
      title={[repoName, branchLabel].filter(Boolean).join(" · ")}
    >
      {repoName &&
        (repoPath ? (
          <Button
            layout="custom"
            className={`${INLINE_LINK_CLASS_NAME} min-w-0 truncate text-left ${
              branchLabel ? "max-w-[calc(50%-6px)]" : "flex-1"
            }`}
            data-testid="session-hover-workspace"
            title={`${revealLabel} · ${repoPath}`}
            aria-label={`${revealLabel} ${repoPath}`}
            onClick={() => handleRevealPath(repoPath)}
          >
            {repoName}
          </Button>
        ) : (
          <span
            className={
              branchLabel
                ? "max-w-[calc(50%-6px)] min-w-0 truncate"
                : "min-w-0 flex-1 truncate"
            }
            data-testid="session-hover-workspace"
            title={repoName}
          >
            {repoName}
          </span>
        ))}
      {repoName && branchLabel && (
        <span className="mx-1 shrink-0 text-text-4">·</span>
      )}
      {branchLabel && (
        <span
          className={
            repoName
              ? "max-w-[calc(50%-6px)] min-w-0 truncate"
              : "min-w-0 flex-1 truncate"
          }
          data-testid="session-hover-branch"
          title={branchLabel}
        >
          {branchLabel}
        </span>
      )}
    </div>
  </HoverCardMetadataRow>
);

// ── Underlying id / storage ───────────────────────────────────────────────────

interface SessionHoverCardStorageRowProps {
  underlyingSessionId: string | null;
  storageRowPath: string | undefined;
  copiedUnderlyingId: string | null;
  onCopyUnderlyingId: (value: string) => void;
  revealLabel: string;
}

export const SessionHoverCardStorageRow: React.FC<
  SessionHoverCardStorageRowProps
> = ({
  underlyingSessionId,
  storageRowPath,
  copiedUnderlyingId,
  onCopyUnderlyingId,
  revealLabel,
}) => {
  const { t } = useTranslation(["sessions", "common"]);

  return (
    <HoverCardRow
      icon={
        underlyingSessionId ? (
          <HugeiconsIcon
            icon={FingerPrintIcon}
            data-icon="fingerprint"
            size={HOVER_CARD.iconSize}
            strokeWidth={HOVER_CARD.iconStrokeWidth}
          />
        ) : (
          <HugeiconsIcon
            icon={FloppyDiskIcon}
            data-icon="save"
            size={HOVER_CARD.iconSize}
            strokeWidth={HOVER_CARD.iconStrokeWidth}
          />
        )
      }
    >
      <div className="flex min-w-0 items-center gap-1">
        {underlyingSessionId ? (
          <Button
            layout="custom"
            className={`${PATH_ROW_CLASS_NAME} min-w-0 flex-1`}
            title={underlyingSessionId}
            aria-label={`${t("common:actions.copy")} ${t(
              "history.detail.sessionId"
            )}`}
            onClick={() => onCopyUnderlyingId(underlyingSessionId)}
          >
            <HoverCardMetadataValue label={t("history.detail.sessionId")}>
              {formatCompactSessionId(underlyingSessionId)}
            </HoverCardMetadataValue>
            {copiedUnderlyingId === underlyingSessionId && (
              <HugeiconsIcon
                icon={Tick01Icon}
                data-icon="check"
                size={HOVER_CARD.compactIconSize}
                strokeWidth={HOVER_CARD.feedbackStrokeWidth}
                className="ml-1 inline-block align-[-1px] text-success-6"
                aria-hidden="true"
              />
            )}
          </Button>
        ) : storageRowPath ? (
          <Button
            layout="custom"
            className={`${PATH_ROW_CLASS_NAME} min-w-0 flex-1`}
            title={`${revealLabel} · ${storageRowPath}`}
            aria-label={`${revealLabel} ${storageRowPath}`}
            onClick={() => handleRevealPath(storageRowPath)}
          >
            {formatCompactPath(storageRowPath)}
          </Button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-text-2">
            {t("history.detail.cliNativeStore")}
          </span>
        )}
        {/* Transcript file for a row already spoken for by the id. */}
        {underlyingSessionId && storageRowPath && (
          <Button
            variant="tertiary"
            size="mini"
            iconOnly
            icon={
              <HugeiconsIcon
                icon={FloppyDiskIcon}
                data-icon="save"
                size={HOVER_CARD.compactIconSize}
                strokeWidth={HOVER_CARD.iconStrokeWidth}
              />
            }
            className={REVEAL_ICON_BUTTON_CLASS_NAME}
            title={`${revealLabel} · ${storageRowPath}`}
            aria-label={`${revealLabel} ${storageRowPath}`}
            onClick={() => handleRevealPath(storageRowPath)}
          />
        )}
      </div>
    </HoverCardRow>
  );
};

// ── Agent activity ────────────────────────────────────────────────────────────

interface SessionHoverCardActivityRowProps {
  workedDurationLabel: string | null;
  turnOverview: SessionTurnOverview | null;
}

export const SessionHoverCardActivityRow: React.FC<
  SessionHoverCardActivityRowProps
> = ({ workedDurationLabel, turnOverview }) => {
  const { t } = useTranslation(["sessions", "common"]);

  return (
    <HoverCardMetadataRow icon={Timer01Icon} dataIcon="timer">
      <div
        className="truncate text-text-2"
        title={workedDurationLabel ?? undefined}
      >
        <span className="text-text-3">
          {workedDurationLabel
            ? t("history.detail.agentWorked")
            : t("history.detail.rounds")}
        </span>
        {workedDurationLabel && (
          <>
            <span className="mx-1 text-text-4">·</span>
            <span>{workedDurationLabel}</span>
          </>
        )}
        {turnOverview && turnOverview.turnCount > 0 && (
          <>
            <span className="mx-1 text-text-4">·</span>
            <span>
              {t("history.detail.roundCount", {
                count: turnOverview.turnCount,
              })}
            </span>
          </>
        )}
      </div>
    </HoverCardMetadataRow>
  );
};
