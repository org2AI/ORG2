import { useAtomValue } from "jotai";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { HoverCardPanel } from "@src/components/HoverCard/HoverCardBase";
import {
  HoverCardMetadataRow,
  HoverCardMetadataValue,
} from "@src/components/HoverCard/HoverCardMetadataRow";
import TaskImpactLine from "@src/features/KanbanBoard/components/TaskImpactLine";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { createLogger } from "@src/hooks/logger";
import { useResolvedModelLabel } from "@src/hooks/models";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import { useKeyedCopyCheck } from "@src/hooks/ui/useCopyCheck";
import {
  Clock01Icon,
  FileDiffIcon,
  GitCommitVerticalIcon,
  GitForkIcon,
} from "@src/icons";
import { workspaceGitStatusMapAtom } from "@src/store/git/gitStatusAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom/atoms";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace/derived";
import { copyText } from "@src/util/data/clipboard";
import {
  formatReplayDateLabel,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";
import { formatBranchLabel } from "@src/util/git/branchLabel";
import { basename } from "@src/util/path";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";
import { isHumanSession } from "@src/util/session/sessionDispatch";
import { resolveSessionDisplayMetadata } from "@src/util/session/sessionDisplayMetadata";
import { formatDuration } from "@src/util/time/formatDuration";

import {
  SessionHoverCardActivityRow,
  SessionHoverCardAgentRow,
  SessionHoverCardRepoBranchRow,
  SessionHoverCardStorageRow,
} from "./SessionHoverCardRows";
import {
  getAgentSessionInfo,
  normalizePath,
} from "./sessionHoverCardContentHelpers";
import {
  buildHoverCardImpactTask,
  resolveHoverCardLastModel,
} from "./sessionHoverCardDerivations";
import { COPIED_FLASH_MS } from "./sessionIdFormat";
import { useSessionHoverCardSources } from "./useSessionHoverCardSources";
import {
  type SessionTurnOverview,
  useSessionTurnOverview,
} from "./useSessionTurnOverview";

const logger = createLogger("SessionHoverCard");

interface SessionHoverCardContentProps {
  sessionId: string;
}

export const SessionHoverCardContent: React.FC<SessionHoverCardContentProps> =
  memo(({ sessionId }) => {
    const { t, i18n } = useTranslation(["sessions", "common"]);
    const session = useAtomValue(sessionByIdAtom(sessionId));
    const humanSession = isHumanSession(sessionId);
    const sessionDisplay = useMemo(
      () =>
        session
          ? resolveSessionDisplayMetadata({ kind: "local", session })
          : null,
      [session]
    );
    const workspaceGitStatusMap = useAtomValue(workspaceGitStatusMapAtom);
    const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);
    const { currentBranch: activeWorkspaceBranch } = useRepoSelection({
      autoLoad: false,
    });
    const creatorDefaultLastModel = useValidatedLastPair();
    const turnOverview: SessionTurnOverview | null =
      useSessionTurnOverview(sessionId);
    const repoPath = session?.repoPath;
    const storagePath = session?.storagePath;
    const cliAgentType = session?.cliAgentType;
    const copyUnderlyingId = useCallback(
      async (value: string) => {
        try {
          await copyText(value);
        } catch (error) {
          logger.warn("failed to copy session id", { error, sessionId });
          throw error;
        }
      },
      [sessionId]
    );
    // Keyed on the copied id so switching cards never shows a stale check.
    const {
      copiedKey: copiedUnderlyingId,
      handleCopy: handleCopyUnderlyingId,
    } = useKeyedCopyCheck(copyUnderlyingId, { durationMs: COPIED_FLASH_MS });

    const { orgtrackSummary, transcriptLocation, underlyingSessionId } =
      useSessionHoverCardSources({ sessionId, cliAgentType });

    const lastModel = useMemo(
      () =>
        resolveHoverCardLastModel({
          humanSession,
          session,
          creatorDefaultLastModel,
          sessionDisplay,
        }),
      [creatorDefaultLastModel, humanSession, session, sessionDisplay]
    );

    const { label: resolvedModelLabel, title: resolvedModelTitle } =
      useResolvedModelLabel(lastModel, []);
    const modelLabel = humanSession ? null : resolvedModelLabel;
    const modelTitle = humanSession ? null : resolvedModelTitle;

    const impactTask = useMemo(
      () => buildHoverCardImpactTask(session, orgtrackSummary),
      [orgtrackSummary, session]
    );

    if (!session) return null;
    const resolvedSessionDisplay =
      sessionDisplay ??
      resolveSessionDisplayMetadata({ kind: "local", session });

    const repoName = session.repo_name || (repoPath ? basename(repoPath) : "");
    const worktreePath = session.worktreePath;
    const normalizedRepoPath = repoPath ? normalizePath(repoPath) : undefined;
    const workspaceGitStatus = normalizedRepoPath
      ? workspaceGitStatusMap.get(normalizedRepoPath)
      : undefined;
    const worktreePathLabel = worktreePath ? basename(worktreePath) : "";
    const effectiveBranch = session.branch;
    const sessionRepoMatchesActive =
      !!normalizedRepoPath &&
      !!activeWorkspaceRootPath &&
      normalizedRepoPath === normalizePath(activeWorkspaceRootPath);
    const branchLabel =
      formatBranchLabel(effectiveBranch) ||
      formatBranchLabel(session.baseBranch) ||
      formatBranchLabel(workspaceGitStatus?.current_branch) ||
      (sessionRepoMatchesActive
        ? formatBranchLabel(activeWorkspaceBranch)
        : "");
    const worktreeBranchLabel =
      formatBranchLabel(session.worktreeBranch) ||
      (worktreePath ? worktreePathLabel : "");
    const modelIconName =
      lastModel?.listingModel || lastModel?.model || undefined;
    const modelIconAgent =
      lastModel?.listingModelType || resolvedSessionDisplay.cliAgentType;
    const agentSessionInfo = getAgentSessionInfo(resolvedSessionDisplay);
    // Native-transcript sessions must not claim sessions.db: show the CLI
    // store file when resolved, else a plain "CLI native store" label.
    const isNativeTranscript = transcriptLocation?.native === true;
    const storageRowPath = isNativeTranscript
      ? (transcriptLocation?.path ?? undefined)
      : storagePath;
    const revealLabel = t(getFileManagerRevealLabelKey());

    const dateTimeLabelOptions = {
      todayLabel: t("common:relativeDate.today"),
      yesterdayLabel: t("common:relativeDate.yesterday"),
      locale: toIntlLocaleTag(i18n.language),
      monthStyle: "short" as const,
      withSeconds: false,
    };
    const createdLabel = formatReplayDateLabel(
      session.created_at || session.created_time,
      dateTimeLabelOptions
    );
    const updatedLabel = formatReplayDateLabel(
      session.updated_at || session.updated_time,
      dateTimeLabelOptions
    );
    const workedDurationLabel = turnOverview?.workedDurationMs
      ? formatDuration(turnOverview.workedDurationMs)
      : null;

    return (
      <HoverCardPanel title={session.name || session.session_id}>
        <SessionHoverCardAgentRow
          agentSessionInfo={agentSessionInfo}
          modelLabel={modelLabel}
          modelTitle={modelTitle}
          modelIconName={modelIconName}
          modelIconAgent={modelIconAgent}
        />
        {(repoName || branchLabel) && (
          <SessionHoverCardRepoBranchRow
            repoName={repoName}
            repoPath={repoPath}
            branchLabel={branchLabel}
            revealLabel={revealLabel}
          />
        )}
        {worktreeBranchLabel && worktreeBranchLabel !== branchLabel && (
          <HoverCardMetadataRow icon={GitForkIcon} dataIcon="git-fork">
            <div
              className="truncate text-text-2"
              data-testid="session-hover-worktree-branch"
              title={worktreeBranchLabel}
            >
              {worktreeBranchLabel}
            </div>
          </HoverCardMetadataRow>
        )}
        {(underlyingSessionId || storageRowPath || isNativeTranscript) && (
          <SessionHoverCardStorageRow
            underlyingSessionId={underlyingSessionId}
            storageRowPath={storageRowPath}
            copiedUnderlyingId={copiedUnderlyingId}
            onCopyUnderlyingId={handleCopyUnderlyingId}
            revealLabel={revealLabel}
          />
        )}
        {impactTask && (
          <HoverCardMetadataRow icon={FileDiffIcon} dataIcon="file-diff">
            <TaskImpactLine task={impactTask} showUnavailable={false} />
          </HoverCardMetadataRow>
        )}
        {(workedDurationLabel ||
          (turnOverview && turnOverview.turnCount > 0)) && (
          <SessionHoverCardActivityRow
            workedDurationLabel={workedDurationLabel}
            turnOverview={turnOverview}
          />
        )}
        <HoverCardMetadataRow icon={Clock01Icon} dataIcon="clock">
          <div className="truncate text-text-2" title={createdLabel}>
            <HoverCardMetadataValue label={t("history.detail.created")}>
              {createdLabel}
            </HoverCardMetadataValue>
          </div>
        </HoverCardMetadataRow>
        <HoverCardMetadataRow
          icon={GitCommitVerticalIcon}
          dataIcon="git-commit-vertical"
        >
          <div className="truncate text-text-2" title={updatedLabel}>
            <HoverCardMetadataValue label={t("history.detail.lastUpdated")}>
              {updatedLabel}
            </HoverCardMetadataValue>
          </div>
        </HoverCardMetadataRow>
      </HoverCardPanel>
    );
  });

SessionHoverCardContent.displayName = "SessionHoverCardContent";
