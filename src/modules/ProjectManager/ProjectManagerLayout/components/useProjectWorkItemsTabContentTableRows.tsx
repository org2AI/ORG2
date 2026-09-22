import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { MemberEntry } from "@src/api/http/project";
import Checkbox from "@src/components/Checkbox";
import IntegrationIcon from "@src/components/IntegrationIcon";
import { WorkManagementAssigneeCell } from "@src/features/GitHubWork/WorkManagementAssigneeCell";
import type { WorkManagementTableRow } from "@src/features/GitHubWork/WorkManagementTable";
import {
  formatWorkItemShortId,
  getWorkItemSourceIntegration,
  isGitHubIssueStatus,
} from "@src/modules/ProjectManager/WorkItems/workItemIdentity";
import { getWorkItemStatus } from "@src/modules/ProjectManager/WorkItems/workItemsViewModel";
import {
  GITHUB_ISSUE_STATUS_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
} from "@src/modules/ProjectManager/config/manage";
import {
  WORKSPACE_SOURCE,
  type WorkspaceWorkItem,
} from "@src/modules/ProjectManager/workspaceAggregate";
import type { WorkItemStatus } from "@src/types/core/workItem";
import { formatCompactAge } from "@src/util/time/formatRelativeTime";

import type { useProjectWorkItemsTabContentInteractions } from "./useProjectWorkItemsTabContentInteractions";

type ProjectWorkItemsInteractions = ReturnType<
  typeof useProjectWorkItemsTabContentInteractions
>;

interface UseProjectWorkItemsTabContentTableRowsParams {
  visibleWorkItems: WorkspaceWorkItem[];
  selectedWorkItemIds: ProjectWorkItemsInteractions["selectedWorkItemIds"];
  workItemPeople: MemberEntry[];
  handleCheckedChange: ProjectWorkItemsInteractions["handleCheckedChange"];
  handleUpdateWorkItem: ProjectWorkItemsInteractions["handleUpdateWorkItem"];
  handleSelectWorkItemAndShowDetail: (workItemId: string) => void;
}

/**
 * Projects the visible workspace work items into WorkManagementTable rows
 * (selection checkbox, id + source icon, assignee cell, status select, age).
 */
export function useProjectWorkItemsTabContentTableRows({
  visibleWorkItems,
  selectedWorkItemIds,
  workItemPeople,
  handleCheckedChange,
  handleUpdateWorkItem,
  handleSelectWorkItemAndShowDetail,
}: UseProjectWorkItemsTabContentTableRowsParams) {
  const { t } = useTranslation("projects");

  return useMemo<WorkManagementTableRow[]>(
    () =>
      visibleWorkItems.map((workItem) => {
        const status = getWorkItemStatus(workItem);
        const isSelected = selectedWorkItemIds.has(workItem.session_id);
        const statusOptions = isGitHubIssueStatus(status)
          ? GITHUB_ISSUE_STATUS_OPTIONS
          : WORK_ITEM_STATUS_OPTIONS;
        const statusOption = statusOptions.find(
          (option) => option.value === status
        );
        const storedId = workItem.shortId || workItem.session_id;
        const displayId =
          formatWorkItemShortId(storedId, status, workItem.project?.name) ??
          storedId;
        const sourceIntegration = getWorkItemSourceIntegration(
          status,
          workItem.workspaceSource?.source
        );
        const tags = Array.from(
          new Set((workItem.labels ?? []).map((label) => label.name))
        );

        return {
          key: workItem.session_id,
          selection: (
            <Checkbox
              checked={isSelected}
              size="small"
              className={`shrink-0 ${
                isSelected ? "" : "**:data-checkbox-icon:bg-bg-2!"
              }`}
              ariaLabel={t("common:workManagementTable.selectRow", {
                id: displayId,
              })}
              onCheckedChange={(checked) =>
                handleCheckedChange(workItem.session_id, checked)
              }
            />
          ),
          idSortValue: displayId,
          id: (
            <div className="flex min-w-0 items-center gap-1.5">
              {sourceIntegration ? (
                <IntegrationIcon
                  type={sourceIntegration}
                  size={14}
                  className="shrink-0 text-text-2"
                />
              ) : null}
              <span className="min-w-0 truncate">{displayId}</span>
            </div>
          ),
          title: workItem.name || t("workItems.untitledWorkItem"),
          titleLinkOnRowHover: true,
          metadata: workItem.project?.name
            ? [workItem.project.name]
            : undefined,
          tags,
          assignee: (
            <WorkManagementAssigneeCell
              currentAssigneeIds={
                workItem.assignee ? [workItem.assignee.id] : []
              }
              options={workItemPeople.map((person) => ({
                id: person.id,
                label: person.name,
                avatar: person.avatar,
              }))}
              noneLabel={t("workItems.properties.noAssignee")}
              loadingLabel={t("common:status.loading")}
              searchPlaceholder={t("properties.searchAssignee")}
              readonlyReason={t("common:errors.forbidden")}
              disabled={
                workItem.workspaceSource?.source === WORKSPACE_SOURCE.LINEAR ||
                !workItem.project
              }
              dataTestId={`work-item-assignee-${workItem.session_id}`}
              onChangeAssigneeIds={(assigneeIds) => {
                const assignee = workItemPeople.find(
                  (person) => person.id === assigneeIds[0]
                );
                return handleUpdateWorkItem(workItem.session_id, {
                  assignee,
                  assigneeType: assignee ? "human" : undefined,
                });
              }}
            />
          ),
          statusSelect: statusOption
            ? {
                value: status,
                label: t(`workItems.statusLabels.${statusOption.value}`, {
                  defaultValue: statusOption.label,
                }),
                icon: statusOption.icon,
                iconColor: statusOption.color,
                options: statusOptions.map((option) => ({
                  value: option.value,
                  label: t(`workItems.statusLabels.${option.value}`, {
                    defaultValue: option.label,
                  }),
                  icon: option.icon,
                  iconColor: option.color,
                })),
                onChange: (nextStatus) =>
                  handleUpdateWorkItem(workItem.session_id, {
                    workItemStatus: nextStatus as WorkItemStatus,
                  }),
                readonly:
                  workItem.workspaceSource?.source === WORKSPACE_SOURCE.LINEAR,
                dataTestId: `work-item-status-${displayId}`,
              }
            : undefined,
          status: statusOption ? undefined : (
            <span className="text-text-2 capitalize">{status}</span>
          ),
          updated: (
            <span title={workItem.updated_time}>
              {formatCompactAge(workItem.updated_time) || "—"}
            </span>
          ),
          onClick: () => handleSelectWorkItemAndShowDetail(workItem.session_id),
        };
      }),
    [
      handleCheckedChange,
      handleSelectWorkItemAndShowDetail,
      handleUpdateWorkItem,
      selectedWorkItemIds,
      t,
      visibleWorkItems,
      workItemPeople,
    ]
  );
}
