import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";
import PrStatusBadge from "@src/components/PrStatusBadge";
import { HEADER_BUTTON, TYPOGRAPHY } from "@src/config/workstation/tokens";
import {
  HugeiconsIcon,
  SquareArrowUpRight02Icon,
  WorkflowCircle05Icon,
} from "@src/icons";
import GitCommitRow from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/GitHistoryContent/GitCommitRow";
import { truncateBranchLabel } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/prCardHelpers";
import { PR_STATUS_UNKNOWN } from "@src/shared/pr/prStatus";

import type {
  PullRequestSubmission,
  SubmissionArtifactOrigin,
  SubmissionCommit,
} from "./submissionsData";

interface SubmissionCommitsContentProps {
  commits: SubmissionCommit[];
  selectedCommitSha: string | null;
  onCommitSelect: (commit: SubmissionCommit) => void;
  emptyLabel: string;
}

interface SubmissionPullRequestsContentProps {
  pullRequests: PullRequestSubmission[];
  emptyLabel: string;
}

function SubmissionArtifactLabel({
  kind,
  origin,
}: {
  kind: "commit" | "pullRequest";
  origin?: SubmissionArtifactOrigin;
}) {
  const { t } = useTranslation("sessions");
  const label = t(
    `simulator.replay.diffApp.submissions.labels.${origin === "created" ? "created" : "mentioned"}.${kind}`,
    origin === "created"
      ? kind === "commit"
        ? "Created commit"
        : "Created PR"
      : kind === "commit"
        ? "Mentioned commit"
        : "Mentioned PR"
  );

  return (
    <span className="shrink-0 rounded-full border border-border-2 bg-fill-1 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-text-3 uppercase">
      {label}
    </span>
  );
}

const PullRequestSubmissionRow: React.FC<{
  pullRequest: PullRequestSubmission;
}> = memo(({ pullRequest }) => {
  const { t } = useTranslation("common");
  const title = pullRequest.prTitle || t("labels.pullRequest", "Pull request");
  const numberLabel = pullRequest.prNumber ? `#${pullRequest.prNumber}` : null;
  const branchLabel = pullRequest.sourceBranch
    ? pullRequest.targetBranch
      ? `${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`
      : pullRequest.sourceBranch
    : null;
  const statusKey = pullRequest.statusKey ?? PR_STATUS_UNKNOWN;

  return (
    <div className="border-b border-fill-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <PrStatusBadge status={statusKey} showDot size="sm" />
        <SubmissionArtifactLabel
          kind="pullRequest"
          origin={pullRequest.origin}
        />
        {numberLabel && (
          <span
            className={`${TYPOGRAPHY.secondary} font-medium text-text-3 tabular-nums`}
          >
            {numberLabel}
          </span>
        )}
        {pullRequest.url && (
          <a
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className={`${HEADER_BUTTON.action} ml-auto`}
            aria-label={t("actions.openOnGitHub", "Open on GitHub")}
            title={t("actions.openOnGitHub", "Open on GitHub")}
          >
            <HugeiconsIcon
              icon={SquareArrowUpRight02Icon}
              data-icon="square-arrow-out-up-right"
              size={14}
            />
          </a>
        )}
      </div>
      <div
        className="mt-1 line-clamp-2 text-[12px] leading-snug font-medium text-text-1"
        title={title}
      >
        {title}
      </div>
      {(branchLabel || pullRequest.repoFullName) && (
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-text-3">
          <HugeiconsIcon
            icon={WorkflowCircle05Icon}
            data-icon="git-branch"
            size={12}
            className="shrink-0"
          />
          <span className="truncate">
            {branchLabel
              ? truncateBranchLabel(branchLabel)
              : pullRequest.repoFullName}
          </span>
        </div>
      )}
    </div>
  );
});

PullRequestSubmissionRow.displayName = "PullRequestSubmissionRow";

export const SubmissionCommitsContent: React.FC<SubmissionCommitsContentProps> =
  memo(({ commits, selectedCommitSha, onCommitSelect, emptyLabel }) => {
    const handleCommitSelect = useCallback(
      (commit: SubmissionCommit) => {
        onCommitSelect(commit);
      },
      [onCommitSelect]
    );

    const commitRows = useMemo(() => {
      // Group consecutive rows by `origin` and render the label once per group
      // (group header), not per row — repeating the same "MENTIONED COMMIT"
      // chip above every entry is visual noise when N entries share an origin.
      const rendered: React.ReactNode[] = [];
      let previousOrigin: SubmissionArtifactOrigin | undefined | "__none__" =
        "__none__";

      for (const commit of commits) {
        const originKey = commit.origin ?? undefined;
        if (originKey !== previousOrigin) {
          rendered.push(
            <div
              key={`origin-${commit.sha}`}
              className="flex items-center px-3 pt-2 pb-1"
            >
              <SubmissionArtifactLabel kind="commit" origin={originKey} />
            </div>
          );
          previousOrigin = originKey;
        }

        rendered.push(
          <div key={commit.sha} className="border-b border-fill-2">
            <GitCommitRow
              commit={commit}
              isSelected={commit.sha === selectedCommitSha}
              onSelect={handleCommitSelect}
              showGraphPlaceholder
            />
          </div>
        );
      }

      return rendered;
    }, [commits, handleCommitSelect, selectedCommitSha]);

    if (commits.length === 0) {
      return (
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyLabel}
          fillParentHeight
        />
      );
    }

    return <div className="scrollbar-hide overflow-auto">{commitRows}</div>;
  });

SubmissionCommitsContent.displayName = "SubmissionCommitsContent";

export const SubmissionPullRequestsContent: React.FC<SubmissionPullRequestsContentProps> =
  memo(({ pullRequests, emptyLabel }) => {
    if (pullRequests.length === 0) {
      return (
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyLabel}
          fillParentHeight
        />
      );
    }

    return (
      <div className="scrollbar-hide overflow-auto">
        {pullRequests.map((pullRequest) => (
          <PullRequestSubmissionRow
            key={pullRequest.key}
            pullRequest={pullRequest}
          />
        ))}
      </div>
    );
  });

SubmissionPullRequestsContent.displayName = "SubmissionPullRequestsContent";
