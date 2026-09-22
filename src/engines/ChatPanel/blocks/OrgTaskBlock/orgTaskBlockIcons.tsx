import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import { getToolIconComponent } from "@src/config/toolIcons";
import {
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  CircleDotIcon,
  HugeiconsIcon,
  PlayCircleIcon,
} from "@src/icons";

import type { OrgTaskAction } from "./orgTaskBlockTypes";

/**
 * Resolve the header icon from the Rust tool registry (`task_create`
 * → `clipboard-copy`, `task_update` → `calendar-sync`). Keeping this in
 * sync with Rust `icon_id` per the frontend ↔ backend alignment rule —
 * we deliberately do not hardcode glyph bindings here.
 */
export function getActionIcon(action: OrgTaskAction) {
  const toolName = action === "create" ? "task_create" : "task_update";
  const icon = getToolIconComponent(toolName);
  return (
    <AnyIcon icon={icon} size={14} strokeWidth={1.75} className="text-text-2" />
  );
}

/**
 * Title-row status indicator: maps the task's lifecycle status to a 13px
 * Icon glyph + color matching the existing AgentOrgTaskList chip palette.
 * Returns `null` for unknown / missing status so the icon slot collapses
 * silently. The "blocked" derived state is intentionally not handled here
 * — `OrgTaskBlock` only sees a single task's `blocks` / `blockedBy` ids,
 * not whether those blocker tasks have completed, so blocked detection
 * lives in the Overview panel (which holds the full task graph) until
 * Rust exposes a `blocked: bool` flag on the extracted payload.
 */
export function getStatusIcon(status?: string): React.ReactNode {
  if (!status) return null;
  if (status === "completed") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle01Icon}
        data-icon="check-circle-2"
        size={13}
        strokeWidth={2}
        className="shrink-0 text-success-6"
        data-testid="org-task-card-status-icon"
      />
    );
  }
  if (status === "in_progress") {
    return (
      <HugeiconsIcon
        icon={PlayCircleIcon}
        data-icon="play-circle"
        size={13}
        strokeWidth={2}
        className="shrink-0 text-primary-6"
        data-testid="org-task-card-status-icon"
      />
    );
  }
  if (status === "pending") {
    return (
      <HugeiconsIcon
        icon={CircleDotIcon}
        data-icon="circle-dot"
        size={13}
        strokeWidth={2}
        className="shrink-0 text-text-3"
        data-testid="org-task-card-status-icon"
      />
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <HugeiconsIcon
        icon={CancelCircleIcon}
        data-icon="x-circle"
        size={13}
        strokeWidth={2}
        className={
          status === "failed"
            ? "text-error-6 shrink-0"
            : "shrink-0 text-warning-6"
        }
        data-testid="org-task-card-status-icon"
      />
    );
  }
  return null;
}
