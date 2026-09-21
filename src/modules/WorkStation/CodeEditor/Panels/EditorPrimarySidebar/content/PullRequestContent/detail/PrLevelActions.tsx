/**
 * PrLevelActions
 *
 * Pull-request level operations (merge / auto-merge / draft / close-reopen)
 * stacked full-width for the GitHub-style operations sidebar. The merge
 * split-button keeps the full merge-method + auto-merge + draft dropdown;
 * reviewer management lives in the sidebar's Reviewers section.
 *
 * The `mergeBox` layout is the same merge control sized for GitHub's merge
 * box under the conversation: the split button hugs its label, "Convert to
 * draft" sits beside it, and the reason merging is (un)available follows. The
 * rail keeps merge and close / reopen only — converting to draft lives in the
 * box alone, so the two never offer it twice on one screen.
 */
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubChecksSummary,
  PullRequestMergeMethod,
} from "@src/api/tauri/github";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DropdownItem, DropdownPanel } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import SplitButton from "@src/components/SplitButton";
import {
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  CircleDotIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  HugeiconsIcon,
} from "@src/icons";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { presentPullRequestActions } from "@src/util/git/pr/prLevelActions";

interface PrLevelActionsProps {
  identity: PrIdentity;
  detail: Record<string, unknown> | null;
  checks: GitHubChecksSummary | null;
  disabled: boolean;
  pending: boolean;
  onMerge: (method: PullRequestMergeMethod) => Promise<void>;
  onSetAutoMerge: (
    enabled: boolean,
    method: PullRequestMergeMethod
  ) => Promise<void>;
  onDraftChange: (draft: boolean) => Promise<void>;
  onStateChange: (state: "open" | "closed") => Promise<void>;
  layout?: "rail" | "mergeBox";
}

const GIT_MERGE_METHOD_LABELS = new Set([
  "Merge",
  "Squash and merge",
  "Rebase and merge",
]);

const ACTION_LABEL_KEYS: Record<string, string> = {
  "Enable auto-merge": "enableAutoMerge",
  "Merge when ready": "mergeWhenReady",
  "Disable auto-merge": "disableAutoMerge",
  "Remove from merge queue": "removeFromMergeQueue",
  Merged: "merged",
  Closed: "closed",
  Draft: "draft",
  "In merge queue": "inMergeQueue",
  "Approval required": "approvalRequired",
  "Changes requested": "changesRequested",
  "Checks failed": "checksFailed",
  "Checks pending": "checksPending",
  "Merge blocked": "mergeBlocked",
};

const ACTION_TOOLTIP_KEYS: Record<string, string> = {
  "Merge this pull request on GitHub": "merge",
  "This pull request is already merged": "alreadyMerged",
  "Reopen this pull request before merging": "reopenBeforeMerging",
  "Mark this pull request ready for review before merging": "markReady",
  "GitHub will merge this pull request through the merge queue": "mergeQueue",
  "GitHub requires review approval before merging": "approvalRequired",
  "Requested changes must be resolved before merging": "changesRequested",
  "Resolve merge conflicts before merging": "resolveConflicts",
  "Required checks must pass before merging": "checksFailed",
  "Wait for required checks or enable auto-merge": "checksPending",
  "GitHub reports unmet merge requirements": "mergeBlocked",
};

function localizedActionLabel(t: TFunction, label: string): string {
  if (GIT_MERGE_METHOD_LABELS.has(label)) return label;
  // These two verdicts are the merge-status headlines, so they share that
  // wording instead of carrying a second translation of the same phrase.
  if (label === "Ready to merge") {
    return t("git.pr.mergeStatus.ableToMerge", label);
  }
  if (label === "Merge conflicts") {
    return t("git.pr.mergeStatus.conflicts", label);
  }
  const key = ACTION_LABEL_KEYS[label];
  return key ? t(`git.pr.actions.${key}`, label) : label;
}

function localizedActionTooltip(t: TFunction, tooltip: string): string {
  const key = ACTION_TOOLTIP_KEYS[tooltip];
  return key ? t(`git.pr.actions.tooltips.${key}`, tooltip) : tooltip;
}

/** Run a PR mutation and surface its outcome as a toast. */
export async function reportPrAction(
  action: () => Promise<void>,
  successMessage: string
): Promise<void> {
  try {
    await action();
    Message.success(successMessage);
  } catch (error) {
    Message.error(error instanceof Error ? error.message : String(error));
  }
}

export const PrLevelActions: React.FC<PrLevelActionsProps> = ({
  identity,
  detail,
  checks,
  disabled,
  pending,
  onMerge,
  onSetAutoMerge,
  onDraftChange,
  onStateChange,
  layout = "rail",
}) => {
  const { t } = useTranslation("common");
  const inMergeBox = layout === "mergeBox";
  const [mergeMenuVisible, setMergeMenuVisible] = useState(false);
  const presentation = presentPullRequestActions({
    detail,
    fallbackStatus: identity.status,
    checks,
  });
  const interactionDisabled = disabled || pending;

  const merge = async (method: PullRequestMergeMethod): Promise<void> => {
    setMergeMenuVisible(false);
    const confirmed = await confirmDestructiveAction({
      title: t("git.pr.actions.confirmMergeTitle", "Merge pull request?"),
      message: t(
        "git.pr.actions.confirmMergeMessage",
        "GitHub will merge the current pull request head into the base branch."
      ),
      okLabel: t("git.pr.actions.merge", "Merge"),
      cancelLabel: t("actions.cancel", "Cancel"),
    });
    if (!confirmed) return;
    await reportPrAction(
      () => onMerge(method),
      t("git.pr.actions.mergeSuccess", "Pull request merged")
    );
  };

  const toggleAutoMerge = async (): Promise<void> => {
    const action = presentation.autoMergeAction;
    if (!action) return;
    setMergeMenuVisible(false);
    const enabled = action.kind === "enable";
    await reportPrAction(
      () => onSetAutoMerge(enabled, presentation.defaultMethod),
      action.label === "Merge when ready"
        ? t("git.pr.actions.mergeRequested", "Merge requested")
        : action.label === "Remove from merge queue"
          ? t("git.pr.actions.removedFromQueue", "Removed from merge queue")
          : enabled
            ? t("git.pr.actions.autoMergeEnabled", "Auto-merge enabled")
            : t("git.pr.actions.autoMergeDisabled", "Auto-merge disabled")
    );
  };

  const runPrimaryMergeAction = (): void => {
    if (presentation.autoMergeAction?.kind === "disable") {
      void toggleAutoMerge();
    } else if (presentation.directMergeAvailable) {
      void merge(presentation.defaultMethod);
    } else if (presentation.autoMergeAction?.kind === "enable") {
      void toggleAutoMerge();
    } else if (
      presentation.status === "draft" ||
      presentation.status === "open"
    ) {
      setMergeMenuVisible(true);
    }
  };

  const changeDraftState = async (draft: boolean): Promise<void> => {
    setMergeMenuVisible(false);
    await reportPrAction(
      () => onDraftChange(draft),
      draft
        ? t(
            "git.pr.actions.convertedToDraft",
            "Pull request converted to draft"
          )
        : t(
            "git.pr.actions.markedReady",
            "Pull request marked ready for review"
          )
    );
  };

  const nextState = presentation.status === "closed" ? "open" : "closed";
  const canChangeState = presentation.status !== "merged";
  const closeLabel = t("actions.close", "Close");
  const changeState = async (): Promise<void> => {
    if (nextState === "closed") {
      const confirmed = await confirmDestructiveAction({
        title: t("git.pr.actions.confirmCloseTitle", "Close pull request?"),
        message: t(
          "git.pr.actions.confirmCloseMessage",
          "The pull request will remain available and can be reopened later."
        ),
        okLabel: closeLabel,
        cancelLabel: t("actions.cancel", "Cancel"),
      });
      if (!confirmed) return;
    }
    await reportPrAction(
      () => onStateChange(nextState),
      nextState === "closed"
        ? t("git.pr.actions.closeSuccess", "Pull request closed")
        : t("git.pr.actions.reopenSuccess", "Pull request reopened")
    );
  };
  const mergePanel = (
    <DropdownPanel className={DROPDOWN_WIDTHS.wideMenuClass}>
      <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
        {presentation.status === "draft" ? (
          <DropdownItem
            disabled={interactionDisabled}
            onClick={() => void changeDraftState(false)}
            dataTestId="pr-mark-ready-action"
          >
            {t("git.pr.actions.markReady", "Mark ready for review")}
          </DropdownItem>
        ) : null}
        {presentation.autoMergeAction ? (
          <>
            <DropdownItem
              disabled={interactionDisabled}
              onClick={() => void toggleAutoMerge()}
              dataTestId="pr-auto-merge-action"
            >
              {localizedActionLabel(t, presentation.autoMergeAction.label)}
            </DropdownItem>
            <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
          </>
        ) : null}
        {presentation.status !== "draft"
          ? presentation.methods.map(({ method, label }) => (
              <DropdownItem
                key={method}
                disabled={
                  interactionDisabled || !presentation.directMergeAvailable
                }
                onClick={() => void merge(method)}
                dataTestId={`pr-merge-${method}`}
              >
                {localizedActionLabel(t, label)}
              </DropdownItem>
            ))
          : null}
      </div>
    </DropdownPanel>
  );

  const canChangeDraftState =
    presentation.status === "draft" || presentation.status === "open";
  const primaryDisabled =
    interactionDisabled ||
    (!presentation.directMergeAvailable &&
      !presentation.autoMergeAction &&
      !canChangeDraftState);
  const primaryActionLabel = localizedActionLabel(
    t,
    presentation.autoMergeAction?.kind === "disable" ||
      (!presentation.directMergeAvailable &&
        presentation.autoMergeAction?.kind === "enable")
      ? presentation.autoMergeAction.label
      : presentation.label
  );

  const mergeDropdown = (
    <Dropdown
      droplist={mergePanel}
      trigger="click"
      // The rail's button spans its column, so its menu hangs from the right
      // edge; in the merge box the button sits at the left of a wide row, and
      // a right-hung menu would spill out of the box to the left.
      position={inMergeBox ? "bottom-start" : "bottom-end"}
      popupVisible={mergeMenuVisible}
      onVisibleChange={setMergeMenuVisible}
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      <div />
    </Dropdown>
  );
  // The dropdown measures its own zero-width anchor, which the split button
  // renders after its segments — i.e. at the right edge. Pinning the anchor to
  // the button's bottom-left corner is what makes "start" mean the left edge.
  const mergeMenu = inMergeBox ? (
    <div className="absolute bottom-0 left-0" data-merge-menu-anchor>
      {mergeDropdown}
    </div>
  ) : (
    mergeDropdown
  );

  const mergeButton = (
    <SplitButton
      variant={
        presentation.hasConflicts || presentation.status === "draft"
          ? "secondary"
          : "primary"
      }
      tone={
        presentation.hasConflicts
          ? "danger"
          : presentation.status === "draft"
            ? undefined
            : presentation.status === "merged"
              ? "merged"
              : "success"
      }
      size="small"
      icon={
        presentation.status === "draft" ? (
          <HugeiconsIcon
            icon={GitPullRequestDraftIcon}
            data-icon="git-pull-request-draft"
            size={14}
            aria-hidden
          />
        ) : presentation.hasConflicts ? (
          <HugeiconsIcon
            icon={CancelCircleIcon}
            data-icon="xcircle"
            size={14}
            aria-hidden
          />
        ) : presentation.directMergeAvailable ? (
          <HugeiconsIcon
            icon={CheckmarkCircle01Icon}
            data-icon="check-circle-2"
            size={14}
            aria-hidden
          />
        ) : (
          <HugeiconsIcon
            icon={GitMergeIcon}
            data-icon="git-merge"
            size={14}
            aria-hidden
          />
        )
      }
      loading={pending}
      disabled={primaryDisabled}
      className={[
        primaryDisabled ? "opacity-100!" : "",
        presentation.status === "draft" ? "bg-fill-3! text-text-1!" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={localizedActionTooltip(t, presentation.tooltip)}
      onClick={runPrimaryMergeAction}
      menu={mergeMenu}
      onMenuButtonClick={(event) => {
        event.stopPropagation();
        setMergeMenuVisible((visible) => !visible);
      }}
      menuOpen={mergeMenuVisible}
      menuButtonLabel={primaryActionLabel}
      widthMode={inMergeBox ? "hug" : "fill"}
      menuSegmentWidth={28}
      // `centerLabel` lifts the icon out of flow to center the label of a
      // full-width button; on one that hugs its label the icon lands outside.
      contentAlignment={inMergeBox ? undefined : "whole"}
      centerLabel={!inMergeBox}
      data-testid={inMergeBox ? "pr-merge-box-action" : "pr-merge-action"}
    >
      {inMergeBox ? (
        // A hugging split button ends its label flush against the menu
        // segment's divider; the rail's full-width one has room to spare.
        <span className="pr-2">{primaryActionLabel}</span>
      ) : (
        primaryActionLabel
      )}
    </SplitButton>
  );

  if (inMergeBox) {
    const mergeBoxHint =
      ACTION_TOOLTIP_KEYS[presentation.tooltip] === "merge"
        ? null
        : localizedActionTooltip(t, presentation.tooltip);
    return (
      <section
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2"
        aria-label={t("git.pr.actions.label", "Pull request actions")}
        data-testid="pr-merge-box-actions"
      >
        <div className="shrink-0">{mergeButton}</div>
        {presentation.status === "open" ? (
          <Button
            variant="secondary"
            size="small"
            className="shrink-0"
            icon={
              <HugeiconsIcon
                icon={GitPullRequestDraftIcon}
                data-icon="git-pull-request-draft"
                size={14}
                aria-hidden
              />
            }
            disabled={interactionDisabled}
            onClick={() => void changeDraftState(true)}
            data-testid="pr-convert-to-draft-action"
          >
            {t("git.pr.actions.convertToDraft", "Convert to draft")}
          </Button>
        ) : null}
        {/* Only a state that needs explaining gets a hint; "merge this" beside
            a green merge button says nothing. Sized to its full sentence and
            never shrunk, so a row too narrow for it sends the whole hint under
            the buttons instead of squeezing it into a wrapped column. */}
        {mergeBoxHint ? (
          <span className="max-w-full shrink-0 grow basis-auto text-[12px] leading-[18px] text-text-3">
            {mergeBoxHint}
          </span>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="flex w-full flex-col gap-2"
      aria-label={t("git.pr.actions.label", "Pull request actions")}
      data-testid="pr-level-actions"
    >
      {mergeButton}

      {canChangeState ? (
        <Button
          size="small"
          long
          centerLabel
          icon={
            nextState === "closed" ? (
              <HugeiconsIcon
                icon={GitPullRequestClosedIcon}
                data-icon="git-pull-request-closed"
                size={14}
                aria-hidden
              />
            ) : (
              <HugeiconsIcon
                icon={CircleDotIcon}
                data-icon="circle-dot"
                size={14}
                aria-hidden
              />
            )
          }
          disabled={interactionDisabled}
          onClick={() => void changeState()}
          data-testid="pr-state-action"
        >
          {nextState === "closed"
            ? closeLabel
            : t("git.pr.actions.reopen", "Reopen pull request")}
        </Button>
      ) : null}
    </section>
  );
};

PrLevelActions.displayName = "PrLevelActions";
