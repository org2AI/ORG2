/**
 * OrgTaskBlock — Compact task card for AgentOrg task_create / task_update events.
 *
 * Shown in the chat stream when a coordinator agent creates a new task and
 * assigns it to a member, or updates an existing task's owner / status.
 * Reuses TaskCard's CSS class names and KanbanBoard utilities for visual
 * consistency with the Kanban board.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";
import type { ResolvedOrgTaskOperationOutcome } from "@src/engines/SessionCore/rendering/orgTaskOutcome";
import { formatSmartDateTime } from "@src/util/data/formatters/date";

import ToolUsageBadge from "../ToolCallBlock/ToolUsageBadge";
import {
  EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";
import { CompactTaskCard } from "./CompactTaskCard";
import { getActionIcon } from "./orgTaskBlockIcons";
import type { OrgTaskAction } from "./orgTaskBlockTypes";
import { useOrgTaskBlockHeaderCopy } from "./useOrgTaskBlockHeaderCopy";

// ============================================
// Types
// ============================================

export type { OrgTaskAction } from "./orgTaskBlockTypes";

interface OrgTaskBlockProps {
  action: OrgTaskAction;
  title: string;
  description?: string;
  ownerName?: string;
  status?: string;
  /** Live bounded Run View overlay; the event's original `status` is retained. */
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
  /**
   * For `action === "update"`: true when the task's `status` field was
   * mutated by this event. Drives the header copy ("Update task status"
   * vs "Update task detail") and the "Marked as ..." subtitle. Ignored
   * when `action !== "update"`.
   */
  statusChanged?: boolean;
  taskAssignedDispatched?: boolean;
  completionDeferred?: boolean;
  operationOutcome?: ResolvedOrgTaskOperationOutcome;
  operationMessage?: string;
  isLoading?: boolean;
  eventId?: string;
  /** ISO timestamp of the underlying event; shown at the right end of the header. */
  timestamp?: string;
  /**
   * When true, skip the internal `EventBlockHeader` entirely and always
   * render the task body. Used by the simulator Messages app, where the
   * outer chat bubble already provides a sender header + verb phrase
   * (e.g. "Planner updated task") and a second internal header would be
   * redundant. Chat-panel callers leave this `false` (default).
   */
  hideHeader?: boolean;
  /** Optional group-chat sender name merged into the task header title. */
  groupSenderName?: string | null;
  toolUsage?: ToolUsageMetadata;
}

// ============================================
// Main Block
// ============================================

const OrgTaskBlock: React.FC<OrgTaskBlockProps> = ({
  action,
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
  statusChanged,
  taskAssignedDispatched,
  completionDeferred = false,
  operationOutcome = "succeeded",
  operationMessage,
  isLoading = false,
  eventId,
  timestamp,
  hideHeader = false,
  groupSenderName = null,
  toolUsage,
}) => {
  const { t } = useTranslation("sessions");
  const yesterdayLabel = t("common:relativeDate.yesterday");
  const formattedTimestamp = timestamp
    ? formatSmartDateTime(timestamp, { yesterdayLabel })
    : null;

  const {
    isCollapsed,
    isHeaderHovered,
    handleHeaderClick,
    handleLocate,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
  } = useBlockHeader({
    defaultCollapsed: false,
    eventId,
    collapseAllValue: true,
  });

  const icon = getActionIcon(action);

  const { headerTitle, headerSubtitle } = useOrgTaskBlockHeaderCopy({
    action,
    ownerName,
    status,
    statusChanged,
    completionDeferred,
    operationOutcome,
    groupSenderName,
  });

  const hasContent = Boolean(
    title ||
    description ||
    ownerName ||
    status ||
    blocks.length > 0 ||
    blockedBy.length > 0 ||
    operationOutcome !== "succeeded" ||
    operationMessage
  );

  // Header-less variant (simulator Messages app): drop the EventBlockHeader
  // and the transparent shell wrapper — render the task body directly so
  // the chat bubble owns the title row.
  if (hideHeader) {
    if (!hasContent) return null;
    return (
      <div
        className={`${getEventBlockContainerClasses(true)} animate-fade-in p-3`}
      >
        <CompactTaskCard
          title={title}
          description={description}
          ownerName={ownerName}
          status={status}
          currentStatus={currentStatus}
          currentUpdatedAt={currentUpdatedAt}
          currentOwnerName={currentOwnerName}
          currentGeneration={currentGeneration}
          currentReplacementTaskId={currentReplacementTaskId}
          currentRecordUnavailable={currentRecordUnavailable}
          priority={priority}
          blocks={blocks}
          blockedBy={blockedBy}
          ownerChanged={ownerChanged}
          taskAssignedDispatched={taskAssignedDispatched}
          completionDeferred={completionDeferred}
          operationOutcome={operationOutcome}
          operationMessage={operationMessage}
          formattedTimestamp={formattedTimestamp}
          timestamp={timestamp}
          hideAssignedRow={
            action === "create" ||
            action === "delete" ||
            operationOutcome !== "succeeded"
          }
        />
      </div>
    );
  }

  return (
    <div className={`${getEventBlockContainerClasses(false)} animate-fade-in`}>
      <EventBlockHeader
        isCollapsed={isCollapsed}
        withHover={false}
        onToggleCollapse={hasContent ? handleHeaderClick : undefined}
        onNavigate={handleLocate}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
        rightContent={
          toolUsage ? <ToolUsageBadge usage={toolUsage} /> : undefined
        }
      >
        <EventBlockHeaderIcon
          icon={icon}
          isCollapsed={isCollapsed}
          isHeaderHovered={isHeaderHovered}
          hasContent={hasContent}
          isLoading={isLoading}
        />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {headerTitle}
        </EventBlockHeaderTitle>
        {headerSubtitle && (
          <EventBlockHeaderSubtitle
            isLoading={isLoading}
            title={headerSubtitle}
          >
            {headerSubtitle}
          </EventBlockHeaderSubtitle>
        )}
      </EventBlockHeader>

      {!isCollapsed && hasContent && (
        <div
          className={`${EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES} animate-fade-in p-3`}
        >
          <CompactTaskCard
            title={title}
            description={description}
            ownerName={ownerName}
            status={status}
            currentStatus={currentStatus}
            currentUpdatedAt={currentUpdatedAt}
            currentOwnerName={currentOwnerName}
            currentGeneration={currentGeneration}
            currentReplacementTaskId={currentReplacementTaskId}
            currentRecordUnavailable={currentRecordUnavailable}
            priority={priority}
            blocks={blocks}
            blockedBy={blockedBy}
            ownerChanged={ownerChanged}
            taskAssignedDispatched={taskAssignedDispatched}
            completionDeferred={completionDeferred}
            operationOutcome={operationOutcome}
            operationMessage={operationMessage}
            formattedTimestamp={formattedTimestamp}
            timestamp={timestamp}
            hideAssignedRow={
              action === "create" ||
              action === "delete" ||
              operationOutcome !== "succeeded"
            }
          />
        </div>
      )}
    </div>
  );
};

OrgTaskBlock.displayName = "OrgTaskBlock";

export default OrgTaskBlock;
