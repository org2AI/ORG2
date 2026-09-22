import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import DiffStatsBadge from "@src/components/DiffStatsBadge";
import HoverCard, {
  type HoverCardTriggerProps,
} from "@src/components/HoverCard";
import { HoverCardPanel } from "@src/components/HoverCard/HoverCardBase";
import {
  HoverCardMetadataRow,
  HoverCardMetadataValue,
} from "@src/components/HoverCard/HoverCardMetadataRow";
import { HoverCardUrlRow } from "@src/components/HoverCard/HoverCardUrlRow";
import { formatHoverCardTimeAgo } from "@src/components/HoverCard/hoverCardTime";
import {
  Clock01Icon,
  FileDiffIcon,
  GitPullRequestIcon,
  WorkflowCircle05Icon,
} from "@src/icons";
import {
  getPrStatusLabelKey,
  getPrStatusVariant,
} from "@src/util/git/pr/prStatus";

export interface PrHoverCardData {
  number: number;
  url?: string;
  title: string;
  state: string;
  head_branch?: string;
  base_branch?: string;
  draft?: boolean;
  additions?: number | null;
  deletions?: number | null;
  updated_at?: string;
}

interface PrHoverCardProps extends HoverCardTriggerProps {
  pr?: PrHoverCardData | null;
}

interface PrHoverCardContentProps {
  pr: PrHoverCardData;
}

function truncateBranchLabel(branch: string, max = 80): string {
  const trimmed = branch.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return "…";
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

const PrHoverCardContent: React.FC<PrHoverCardContentProps> = memo(({ pr }) => {
  const { i18n, t } = useTranslation("common");
  const statusKey = pr.draft ? "draft" : pr.state;
  const statusVariant = getPrStatusVariant(statusKey);
  const statusIconClassName = statusVariant.dotClass.replace("bg-", "text-");
  const branchLabel = pr.head_branch
    ? truncateBranchLabel(pr.head_branch)
    : null;
  const additions = pr.additions ?? 0;
  const deletions = pr.deletions ?? 0;
  const hasDiffStats = additions > 0 || deletions > 0;

  return (
    <HoverCardPanel title={pr.title}>
      <HoverCardMetadataRow
        icon={GitPullRequestIcon}
        dataIcon="git-pull-request"
        iconClassName={statusIconClassName}
      >
        <div className="truncate text-text-2">
          <span>{t(getPrStatusLabelKey(statusKey), statusKey)}</span>
          <span className="mx-1 text-text-4">·</span>
          <span>#{pr.number}</span>
        </div>
      </HoverCardMetadataRow>

      {pr.url && <HoverCardUrlRow url={pr.url} />}

      {branchLabel && (
        <HoverCardMetadataRow icon={WorkflowCircle05Icon} dataIcon="git-branch">
          <div className="truncate text-text-2" title={pr.head_branch}>
            <span>{branchLabel}</span>
            {pr.base_branch && (
              <>
                <span className="mx-1 text-text-4">·</span>
                <span className="text-text-3">{pr.base_branch}</span>
              </>
            )}
          </div>
        </HoverCardMetadataRow>
      )}

      {hasDiffStats && (
        <HoverCardMetadataRow icon={FileDiffIcon} dataIcon="file-diff">
          <div
            className="flex min-w-0 items-center"
            data-testid="pr-hover-card-diff-stats"
          >
            <span className="text-text-3">{t("git.pr.tabs.changes")}</span>
            <span className="mx-1 text-text-4">·</span>
            <DiffStatsBadge
              additions={additions}
              deletions={deletions}
              variant="plain"
              size="md"
              weight="normal"
              reserveValueWidth={false}
            />
          </div>
        </HoverCardMetadataRow>
      )}

      {pr.updated_at && (
        <HoverCardMetadataRow icon={Clock01Icon} dataIcon="clock">
          <div className="truncate text-text-2">
            <HoverCardMetadataValue label={t("git.issues.updated")}>
              {formatHoverCardTimeAgo(pr.updated_at, i18n.language)}
            </HoverCardMetadataValue>
          </div>
        </HoverCardMetadataRow>
      )}
    </HoverCardPanel>
  );
});

PrHoverCardContent.displayName = "PrHoverCardContent";

const PrHoverCard: React.FC<PrHoverCardProps> = ({
  pr,
  position = "right-start",
  ...triggerProps
}) => {
  return (
    <HoverCard
      {...triggerProps}
      cardId={pr ? `github-pr:${pr.number}` : null}
      position={position}
      content={pr ? <PrHoverCardContent pr={pr} /> : null}
    />
  );
};

export default PrHoverCard;
