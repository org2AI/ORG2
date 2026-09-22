import React from "react";
import { useTranslation } from "react-i18next";

import PageNotice from "@src/components/PageNotice";
import type { ResolvedOrgTaskOperationOutcome } from "@src/engines/SessionCore/rendering/orgTaskOutcome";
import { PriorityIndicator } from "@src/features/KanbanBoard/utils/priority";

import {
  OrgTaskDependencyBadge,
  OrgTaskMetaRows,
  OrgTaskOwnerChangedBadge,
} from "../OrgTaskBadges";
import { getStatusIcon } from "./orgTaskBlockIcons";

// ============================================
// Compact inline task card (no drag, no click)
// ============================================

export function CompactTaskCard({
  title,
  description,
  ownerName,
  status,
  currentStatus,
  currentUpdatedAt,
  currentOwnerName,
  currentGeneration,
  currentReplacementTaskId,
  currentRecordUnavailable,
  priority,
  blocks = [],
  blockedBy = [],
  ownerChanged,
  taskAssignedDispatched,
  completionDeferred = false,
  operationOutcome = "succeeded",
  operationMessage,
  formattedTimestamp,
  timestamp,
  hideAssignedRow = false,
}: {
  title: string;
  description?: string;
  ownerName?: string;
  status?: string;
  currentStatus?: string;
  currentUpdatedAt?: string;
  currentOwnerName?: string | null;
  currentGeneration?: number;
  currentReplacementTaskId?: string;
  currentRecordUnavailable?: boolean;
  priority?: string;
  blocks?: string[];
  blockedBy?: string[];
  ownerChanged?: boolean;
  taskAssignedDispatched?: boolean;
  completionDeferred?: boolean;
  operationOutcome?: ResolvedOrgTaskOperationOutcome;
  operationMessage?: string;
  formattedTimestamp?: string | null;
  timestamp?: string;
  /**
   * When true, suppress the "Assigned to {ownerName}" meta row in the body.
   * Used by `action === "create"` cards where the owner is already shown in
   * the header title ("Assign task to {ownerName}"), so repeating it in the
   * body would be redundant.
   */
  hideAssignedRow?: boolean;
}) {
  const { t } = useTranslation("sessions");

  const operationAccepted = operationOutcome === "succeeded";
  const taskSnapshotIsAuthoritative = operationAccepted || completionDeferred;
  const statusLabel =
    taskSnapshotIsAuthoritative && status
      ? t(`orgTask.status.${status}`, { defaultValue: status })
      : null;
  const hasCurrentStatusOverlay =
    operationAccepted && Boolean(currentStatus) && currentStatus !== status;
  const currentStatusLabel = hasCurrentStatusOverlay
    ? t(`orgTask.status.${currentStatus}`, { defaultValue: currentStatus })
    : null;
  const hasCurrentOwnerOverlay =
    operationAccepted &&
    currentStatus != null &&
    currentOwnerName !== (ownerName ?? null);
  const currentOwnerLabel = hasCurrentOwnerOverlay
    ? (currentOwnerName ?? t("orgTask.unassignedOwner"))
    : null;
  const currentRecordUnavailableLabel = currentRecordUnavailable
    ? t("orgTask.currentRecordUnavailable")
    : null;
  const assignedLabel =
    operationAccepted && taskAssignedDispatched
      ? t("orgTask.assignedBadge")
      : null;
  const outcomeLabel = operationAccepted
    ? null
    : completionDeferred
      ? t("orgTask.outcome.deferred")
      : t(`orgTask.outcome.${operationOutcome}`, {
          defaultValue: operationOutcome,
        });
  const statusRowLabel = completionDeferred
    ? [outcomeLabel, statusLabel].filter(Boolean).join(" · ")
    : (outcomeLabel ??
      [assignedLabel, statusLabel].filter(Boolean).join(" · "));
  const dependencyCount = blocks.length + blockedBy.length;

  const showAssignedRow =
    operationAccepted && Boolean(ownerName) && !hideAssignedRow;
  const hasMetaRows = Boolean(
    showAssignedRow ||
    formattedTimestamp ||
    statusRowLabel ||
    currentStatusLabel ||
    currentOwnerLabel ||
    currentRecordUnavailableLabel ||
    currentReplacementTaskId
  );

  return (
    <div
      className="org-task-block__card"
      data-testid="org-task-card"
      data-operation-outcome={
        completionDeferred ? "deferred" : operationOutcome
      }
      data-event-status={status}
      data-current-status={currentStatus ?? status}
      data-current-owner={
        currentStatus != null ? (currentOwnerName ?? "unassigned") : undefined
      }
      data-current-generation={currentGeneration}
      data-current-replacement-task-id={currentReplacementTaskId}
      data-current-record-unavailable={currentRecordUnavailable || undefined}
    >
      {/* Title row — leading status icon + title + badges (owner-changed / deps); assigned + status merged into meta rows below */}
      <div className="kanban-task-card__header mb-0">
        <div className="kanban-task-card__title flex min-w-0 items-center gap-1.5 text-[13px]">
          {taskSnapshotIsAuthoritative
            ? getStatusIcon(currentStatus ?? status)
            : null}
          <span className="min-w-0 truncate">{title}</span>
        </div>
        {ownerChanged && <OrgTaskOwnerChangedBadge />}
        <OrgTaskDependencyBadge count={dependencyCount} />
      </div>

      {/* Description */}
      {description && (
        <div className="kanban-task-card__description mt-1 text-[11px]">
          {description}
        </div>
      )}

      {!operationAccepted && (
        <PageNotice
          type={
            operationOutcome === "failed"
              ? "danger"
              : completionDeferred || operationOutcome === "rejected"
                ? "warning"
                : "info"
          }
          title={outcomeLabel ?? undefined}
          className="mt-2"
        >
          {operationMessage}
        </PageNotice>
      )}

      {/* Meta rows: Assigned to / Updated at / Status — inline with vertical separators when there is room, wraps to multiple lines otherwise. */}
      {hasMetaRows && (
        <OrgTaskMetaRows>
          {showAssignedRow && (
            <div
              className="flex min-w-0 items-center gap-2"
              data-testid="org-task-block-assigned-to"
            >
              <span className="shrink-0 text-text-3">
                {t("orgTask.assignedToLabel")}
              </span>
              <span className="min-w-0 truncate text-text-1" title={ownerName}>
                {ownerName}
              </span>
              {priority && (
                <span className="shrink-0">
                  <PriorityIndicator priority={priority} />
                </span>
              )}
            </div>
          )}
          {statusRowLabel && (
            <div
              className="flex min-w-0 items-center gap-2"
              data-testid="org-task-block-status"
            >
              <span className="shrink-0 text-text-3">
                {t("orgTask.statusLabel")}
              </span>
              <span
                className="min-w-0 truncate text-text-1"
                data-testid="org-task-card-status"
              >
                {statusRowLabel}
              </span>
            </div>
          )}
          {currentStatusLabel && (
            <div
              className="flex min-w-0 items-center gap-2"
              data-testid="org-task-block-current-status"
            >
              <span className="shrink-0 text-text-3">
                {t("orgTask.currentStatusLabel")}
              </span>
              <span
                className="min-w-0 truncate text-text-1"
                title={currentUpdatedAt}
                data-testid="org-task-card-current-status"
              >
                {currentStatusLabel}
              </span>
            </div>
          )}
          {currentOwnerLabel && (
            <div
              className="flex min-w-0 items-center gap-2"
              data-testid="org-task-block-current-owner"
            >
              <span className="shrink-0 text-text-3">
                {t("orgTask.currentOwnerLabel")}
              </span>
              <span className="min-w-0 truncate text-text-1">
                {currentOwnerLabel}
              </span>
            </div>
          )}
          {currentRecordUnavailableLabel && (
            <div
              className="flex min-w-0 items-center gap-2"
              data-testid="org-task-block-current-status-unavailable"
            >
              <span className="shrink-0 text-text-3">
                {t("orgTask.currentStatusLabel")}
              </span>
              <span className="min-w-0 truncate text-warning-6">
                {currentRecordUnavailableLabel}
              </span>
            </div>
          )}
          {currentReplacementTaskId && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-text-3">
                {t("orgTask.replacementLabel")}
              </span>
              <span
                className="min-w-0 truncate font-mono text-text-1"
                title={currentReplacementTaskId}
              >
                {currentReplacementTaskId}
              </span>
            </div>
          )}
          {formattedTimestamp && (
            <div
              className="flex min-w-0 items-center gap-2"
              data-testid="org-task-block-updated-at"
            >
              <span className="shrink-0 text-text-3">
                {t("orgTask.updatedAtLabel")}
              </span>
              <span
                className="min-w-0 truncate text-text-1 tabular-nums"
                title={timestamp}
                data-testid="org-task-block-timestamp"
              >
                {formattedTimestamp}
              </span>
            </div>
          )}
        </OrgTaskMetaRows>
      )}
    </div>
  );
}
