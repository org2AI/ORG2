/**
 * PrMergeBox
 *
 * GitHub's merge box at the foot of the PR conversation: a deployments card
 * over one card that stacks the merge conditions — checks (with every check on
 * the head commit listed in place), review, conflicts, queue — above the merge
 * button. Each section is a headline over one detail line, the way GitHub
 * writes them.
 *
 * Verdicts come from `buildPrMergeBox`, which shares its logic with the
 * operations rail; this file only maps identifiers to wording and glyphs. The
 * merge control is `PrLevelActions` in its `mergeBox` layout, so the button
 * here and the one in the rail are the same control.
 */
import type { TFunction } from "i18next";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubChecksSummary,
  GitHubDeploymentsSummary,
  GitHubPrReview,
} from "@src/api/tauri/github";
import Button from "@src/components/Button";
import CiCheckStateIcon from "@src/components/CiCheckStateIcon";
import DisclosureChevron from "@src/components/DisclosureChevron";
import {
  AlertCircleIcon,
  ArrowUpRight01Icon,
  CloudUploadIcon,
  HugeiconsIcon,
} from "@src/icons";
import type { CiCheckItem } from "@src/services/git/ciCheckState";
import {
  type PrMergeBoxChecksSection,
  type PrMergeBoxDeployment,
  type PrMergeBoxDeploymentsSection,
  buildPrMergeBox,
  describeCheckTiming,
} from "@src/util/git/pr/prMergeBox";
import type {
  PrMergeStatusRow,
  PrMergeStatusTone,
} from "@src/util/git/pr/prMergeStatus";
import { formatDuration } from "@src/util/time/formatDuration";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";
import { openLink } from "@src/util/ui/openLink";

import { PrChecksRefreshButton } from "./PrChecksRefreshButton";

// Same shell as the conversation's own cards (`TimelineCard`), so the box reads
// as the last entry of that column rather than a foreign widget.
const CARD_CLASS =
  "overflow-hidden rounded-xl border border-border-1 bg-chat-pane";
const SECTION_CLASS = "flex min-w-0 items-start gap-2 px-3 py-2";
const TITLE_CLASS = "text-[13px] leading-5 text-text-1";
const DETAIL_CLASS = "text-[12px] leading-[18px] text-text-3";
// Glyphs sit on the title's first line: (20px line − 15px glyph) / 2.
const SECTION_ICON_CLASS = "mt-[2.5px] shrink-0";
const SECTION_ICON_SIZE = 15;
const LIST_ROW_CLASS =
  "flex h-7 min-w-0 items-center gap-2 pr-2 pl-[35px] text-[12px]";

const TONE_TEXT_CLASS: Record<PrMergeStatusTone, string> = {
  success: "text-success-6",
  failure: "text-danger-6",
  pending: "text-warning-6",
  neutral: "text-text-3",
};

const CONDITION_TITLES: Partial<Record<PrMergeStatusRow["kind"], string>> = {
  reviewApproved: "Changes approved",
  reviewRequired: "Review required",
  reviewChangesRequested: "Changes requested",
  noConflicts: "No conflicts with the base branch",
  hasConflicts: "This branch has conflicts that must be resolved",
  outOfDate: "This branch is out of date with the base branch",
  checkingConflicts: "Checking for the ability to merge automatically…",
  autoMergeEnabled: "Auto-merge enabled",
  inMergeQueue: "Waiting in the merge queue",
};

const CONDITION_DETAILS: Partial<Record<PrMergeStatusRow["kind"], string>> = {
  reviewApproved: "An approving review was submitted",
  reviewRequired: "At least one approving review is required to merge",
  reviewChangesRequested: "A reviewer requested changes before merging",
  noConflicts: "Merging can be performed automatically",
  hasConflicts: "Resolve the conflicts on the head branch, then push",
  outOfDate: "Merge the latest base branch changes into this branch",
  checkingConflicts: "Hang in there while GitHub checks the branch's status",
  autoMergeEnabled: "This pull request merges once its requirements are met",
  inMergeQueue: "GitHub merges it when it reaches the front of the queue",
};

function openExternal(url: string): void {
  openLink(url, { navigate: true });
}

function checksDetail(t: TFunction, section: PrMergeBoxChecksSection): string {
  const { counts } = section;
  const parts = [
    counts.failure > 0
      ? t("git.pr.mergeBox.counts.failing", {
          count: counts.failure,
          defaultValue: "{{count}} failing",
        })
      : null,
    counts.pending > 0
      ? t("git.pr.mergeBox.counts.inProgress", {
          count: counts.pending,
          defaultValue: "{{count}} in progress",
        })
      : null,
    counts.neutral > 0
      ? t("git.pr.mergeBox.counts.skipped", {
          count: counts.neutral,
          defaultValue: "{{count}} skipped",
        })
      : null,
    counts.success > 0
      ? t("git.pr.mergeBox.counts.successful", {
          count: counts.success,
          defaultValue: "{{count}} successful",
        })
      : null,
  ].filter((part): part is string => part !== null);
  return t("git.pr.mergeBox.counts.summary", {
    count: counts.total,
    parts: parts.join(", "),
    defaultValue: "{{parts}} check",
    defaultValue_other: "{{parts}} checks",
  });
}

function checkStatusLine(t: TFunction, item: CiCheckItem): string {
  const timing = describeCheckTiming(item);
  const duration =
    timing.durationMs === undefined ? "" : formatDuration(timing.durationMs);
  const status =
    timing.kind === "queued"
      ? t("git.pr.mergeBox.check.queued", "Queued")
      : timing.kind === "started"
        ? t("git.pr.mergeBox.check.started", {
            time: formatRelativeTime(timing.startedAt, "long"),
            defaultValue: "Started {{time}}",
          })
        : timing.kind === "successfulIn"
          ? t("git.pr.mergeBox.check.successfulIn", {
              duration,
              defaultValue: "Successful in {{duration}}",
            })
          : timing.kind === "failingAfter"
            ? t("git.pr.mergeBox.check.failingAfter", {
                duration,
                defaultValue: "Failing after {{duration}}",
              })
            : timing.kind === "skipped"
              ? t("git.pr.mergeBox.check.skipped", "Skipped")
              : item.state === "success"
                ? t("git.pr.mergeBox.check.successful", "Successful")
                : t("git.pr.mergeBox.check.failing", "Failing");
  return item.description ? `${status} — ${item.description}` : status;
}

function SectionHeading({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}): React.ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className={TITLE_CLASS}>{title}</span>
      {detail ? <span className={DETAIL_CLASS}>{detail}</span> : null}
    </div>
  );
}

function DetailsLink({
  label,
  url,
}: {
  label: string;
  url: string;
}): React.ReactNode {
  return (
    <Button
      variant="tertiary"
      size="mini"
      iconOnly
      icon={
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          data-icon="arrow-up-right"
          size={13}
          aria-hidden
        />
      }
      className="shrink-0"
      title={label}
      aria-label={label}
      onClick={() => openExternal(url)}
    />
  );
}

function DeploymentRow({
  entry,
}: {
  entry: PrMergeBoxDeployment;
}): React.ReactNode {
  const { t } = useTranslation("common");
  const { deployment, state, tone } = entry;
  const stateLabel =
    state === "active"
      ? t("git.pr.mergeBox.deployments.state.active", "Active")
      : state === "pending"
        ? t("git.pr.mergeBox.deployments.state.pending", "In progress")
        : state === "failure"
          ? t("git.pr.mergeBox.deployments.state.failure", "Failed")
          : t("git.pr.mergeBox.deployments.state.inactive", "Inactive");
  const url = deployment.environment_url ?? deployment.log_url;
  return (
    <div className={LIST_ROW_CLASS} data-testid="pr-merge-box-deployment">
      <CiCheckStateIcon state={tone} size={13} className="shrink-0" />
      <span className="min-w-0 truncate text-text-1">
        {deployment.environment}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-3">
        {deployment.description
          ? `${stateLabel} — ${deployment.description}`
          : stateLabel}
      </span>
      {url ? (
        <DetailsLink
          label={t("git.pr.mergeBox.deployments.view", "View deployment")}
          url={url}
        />
      ) : null}
    </div>
  );
}

const DEPLOYMENT_TITLES: Record<
  PrMergeBoxDeploymentsSection["headline"],
  string
> = {
  notDeployed: "This branch has not been deployed",
  deployed: "This branch was successfully deployed",
  deploying: "This branch is being deployed",
  deployFailed: "This branch had an error being deployed",
  deployInactive: "This branch is no longer deployed",
};

function DeploymentsCard({
  section,
}: {
  section: PrMergeBoxDeploymentsSection;
}): React.ReactNode {
  const { t } = useTranslation("common");
  const detail =
    section.deployments.length === 0
      ? t("git.pr.mergeBox.deployments.none", "No deployments")
      : t("git.pr.mergeBox.deployments.active", {
          count: section.activeCount,
          defaultValue: "{{count}} active deployment",
          defaultValue_other: "{{count}} active deployments",
        });
  return (
    <section
      className={CARD_CLASS}
      aria-label={t("git.pr.mergeBox.deployments.label", "Deployments")}
      data-testid="pr-merge-box-deployments"
    >
      <div className={SECTION_CLASS}>
        <HugeiconsIcon
          icon={CloudUploadIcon}
          data-icon="cloud-upload"
          size={SECTION_ICON_SIZE}
          strokeWidth={1.75}
          className={`${SECTION_ICON_CLASS} ${TONE_TEXT_CLASS[section.tone]}`}
          aria-hidden
        />
        <SectionHeading
          title={t(
            `git.pr.mergeBox.deployments.${section.headline}`,
            DEPLOYMENT_TITLES[section.headline]
          )}
          detail={detail}
        />
      </div>
      {section.deployments.length > 0 ? (
        <div className="border-t border-border-1 py-1">
          {section.deployments.map((entry) => (
            <DeploymentRow key={entry.deployment.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

const CHECKS_TITLES: Record<PrMergeBoxChecksSection["headline"], string> = {
  checksFailed: "Some checks were not successful",
  checksPending: "Some checks haven't completed yet",
  checksPassed: "All checks have passed",
  checksSkipped: "All checks were skipped",
};

function ChecksSection({
  section,
}: {
  section: PrMergeBoxChecksSection;
}): React.ReactNode {
  const { t } = useTranslation("common");
  // The user's toggle wins once made; until then the verdict decides, so a
  // run that turns red opens the list on its own.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? section.defaultExpanded;
  return (
    <div data-testid="pr-merge-box-checks">
      {/* The re-poll button is a sibling laid over the row, not a child of
          the toggle: a button inside a button is invalid and would toggle. */}
      <div className="relative">
        <Button
          layout="custom"
          className={`${SECTION_CLASS} w-full text-left transition-colors hover:bg-fill-1`}
          aria-expanded={expanded}
          onClick={() => setUserExpanded(!expanded)}
          data-testid="pr-merge-box-checks-toggle"
        >
          <CiCheckStateIcon
            state={section.tone}
            size={SECTION_ICON_SIZE}
            className={SECTION_ICON_CLASS}
          />
          <SectionHeading
            title={t(
              `git.pr.mergeBox.${section.headline}`,
              CHECKS_TITLES[section.headline]
            )}
            detail={checksDetail(t, section)}
          />
          {/* Room for the re-poll button that floats over this spot. */}
          <span className="w-6 shrink-0" aria-hidden />
          <DisclosureChevron
            expanded={expanded}
            size={14}
            strokeWidth={1.9}
            className="mt-[3px] shrink-0 text-text-3"
            aria-hidden
          />
        </Button>
        <PrChecksRefreshButton
          className="absolute top-[7px] right-[34px]"
          testId="pr-merge-box-checks-refresh"
        />
      </div>
      {expanded ? (
        <div
          className="scrollbar-hide max-h-64 overflow-y-auto border-t border-border-1 py-1"
          data-testid="pr-merge-box-check-list"
        >
          {section.items.map((item) => (
            <div
              key={item.key}
              className={LIST_ROW_CLASS}
              data-testid="pr-merge-box-check"
            >
              <CiCheckStateIcon
                state={item.state}
                size={13}
                className="shrink-0"
              />
              <span className="min-w-0 shrink truncate text-text-1">
                {item.appName ? `${item.appName} / ${item.name}` : item.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-3">
                {checkStatusLine(t, item)}
              </span>
              {item.detailsUrl ? (
                <DetailsLink
                  label={t("workstation.ci.viewDetails", "View check details")}
                  url={item.detailsUrl}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConditionSection({ row }: { row: PrMergeStatusRow }): React.ReactNode {
  const { t } = useTranslation("common");
  // A spinner promises that something is running. Only the mergeability
  // computation is; a missing review or a stale base waits on a person.
  const waitsOnSomeone =
    row.tone === "pending" && row.kind !== "checkingConflicts";
  return (
    <div className={SECTION_CLASS} data-testid={`pr-merge-box-${row.kind}`}>
      {waitsOnSomeone ? (
        <HugeiconsIcon
          icon={AlertCircleIcon}
          data-icon="alert-circle"
          size={SECTION_ICON_SIZE}
          strokeWidth={1.9}
          className={`${SECTION_ICON_CLASS} ${TONE_TEXT_CLASS.pending}`}
          aria-hidden
        />
      ) : (
        <CiCheckStateIcon
          state={row.tone}
          size={SECTION_ICON_SIZE}
          className={SECTION_ICON_CLASS}
        />
      )}
      <SectionHeading
        title={t(
          `git.pr.mergeBox.conditions.${row.kind}.title`,
          CONDITION_TITLES[row.kind] ?? row.kind
        )}
        detail={t(
          `git.pr.mergeBox.conditions.${row.kind}.detail`,
          CONDITION_DETAILS[row.kind] ?? ""
        )}
      />
    </div>
  );
}

const CLOSED_TITLES = {
  merged: "Pull request successfully merged and closed",
  closed: "Closed with unmerged commits",
} as const;

const CLOSED_DETAILS = {
  merged: "The head branch can be safely deleted",
  closed: "This pull request is closed. Reopen it to merge",
} as const;

export interface PrMergeBoxProps {
  detail: Record<string, unknown> | null;
  fallbackStatus: string;
  checks: GitHubChecksSummary | null;
  deployments: GitHubDeploymentsSummary | null;
  reviews: readonly GitHubPrReview[];
  /** The merge control — `PrLevelActions` in its `mergeBox` layout. */
  actions: React.ReactNode;
}

export const PrMergeBox: React.FC<PrMergeBoxProps> = ({
  detail,
  fallbackStatus,
  checks,
  deployments,
  reviews,
  actions,
}) => {
  const { t } = useTranslation("common");
  const model = useMemo(
    () =>
      buildPrMergeBox({ checks, deployments, detail, fallbackStatus, reviews }),
    [checks, deployments, detail, fallbackStatus, reviews]
  );
  const closedKind =
    model.summary.headline === "merged" || model.summary.headline === "closed"
      ? model.summary.headline
      : null;

  return (
    <div className="flex flex-col gap-2" data-testid="pr-merge-box">
      {model.deployments ? (
        <DeploymentsCard section={model.deployments} />
      ) : null}

      <section
        className={`${CARD_CLASS} divide-y divide-border-1`}
        aria-label={t("git.pr.mergeStatus.label", "Merge status")}
        data-testid="pr-merge-box-status"
      >
        {closedKind ? (
          <div className={SECTION_CLASS} data-testid="pr-merge-box-closed">
            <CiCheckStateIcon
              state={model.summary.headlineTone}
              size={SECTION_ICON_SIZE}
              className={SECTION_ICON_CLASS}
            />
            <SectionHeading
              title={t(
                `git.pr.mergeBox.${closedKind}.title`,
                CLOSED_TITLES[closedKind]
              )}
              detail={t(
                `git.pr.mergeBox.${closedKind}.detail`,
                CLOSED_DETAILS[closedKind]
              )}
            />
          </div>
        ) : (
          <>
            {model.checks ? <ChecksSection section={model.checks} /> : null}
            {model.conditions.map((row) => (
              <ConditionSection key={row.kind} row={row} />
            ))}
            <div className="px-3 py-2.5">{actions}</div>
          </>
        )}
      </section>
    </div>
  );
};

PrMergeBox.displayName = "PrMergeBox";
