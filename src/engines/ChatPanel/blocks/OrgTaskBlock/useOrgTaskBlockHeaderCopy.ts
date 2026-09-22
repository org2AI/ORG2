import { useTranslation } from "react-i18next";

import type { ResolvedOrgTaskOperationOutcome } from "@src/engines/SessionCore/rendering/orgTaskOutcome";

import type { OrgTaskAction } from "./orgTaskBlockTypes";

interface UseOrgTaskBlockHeaderCopyOptions {
  action: OrgTaskAction;
  ownerName: string | undefined;
  status: string | undefined;
  statusChanged: boolean | undefined;
  completionDeferred: boolean;
  operationOutcome: ResolvedOrgTaskOperationOutcome;
  groupSenderName: string | null;
}

export function useOrgTaskBlockHeaderCopy({
  action,
  ownerName,
  status,
  statusChanged,
  completionDeferred,
  operationOutcome,
  groupSenderName,
}: UseOrgTaskBlockHeaderCopyOptions) {
  const { t } = useTranslation("sessions");

  // Header title:
  // - create: "Assign task to {ownerName}" if owner known, else generic.
  // - update: split into "status" vs "detail" so the user can tell at a
  //   glance whether this row is just a lifecycle tick (pending → in_progress
  //   → completed) or a content edit (title / description / owner / deps).
  const updateChangeKind: "status" | "detail" = statusChanged
    ? "status"
    : "detail";
  const operationHeaderTitle =
    operationOutcome === "succeeded"
      ? null
      : groupSenderName != null
        ? t(
            `groupChat.taskHeader.${action}${completionDeferred ? "Deferred" : operationOutcome === "pending" ? "Running" : operationOutcome === "rejected" ? "Rejected" : "Failed"}`,
            {
              sender: groupSenderName,
              defaultValue: completionDeferred
                ? "{{sender}} deferred task completion until cleanup"
                : operationOutcome === "pending"
                  ? "{{sender}} is working on a task operation"
                  : operationOutcome === "rejected"
                    ? "{{sender}}'s task operation needs correction"
                    : "{{sender}}'s task operation failed",
            }
          )
        : t(
            `orgTask.${action}.${completionDeferred ? "deferredTitle" : operationOutcome === "pending" ? "runningTitle" : operationOutcome === "rejected" ? "rejectedTitle" : "failedTitle"}`,
            {
              defaultValue: completionDeferred
                ? "Task completion deferred until cleanup"
                : operationOutcome === "pending"
                  ? "Working on task operation"
                  : operationOutcome === "rejected"
                    ? "Task operation needs correction"
                    : "Task operation failed",
            }
          );
  const headerTitle =
    operationHeaderTitle ??
    (groupSenderName != null
      ? action === "create"
        ? ownerName
          ? t("groupChat.taskHeader.createWithOwner", {
              sender: groupSenderName,
              ownerName,
            })
          : t("groupChat.taskHeader.create", {
              sender: groupSenderName,
            })
        : action === "delete"
          ? t("simulator.replay.messages.bubble.senderTitle.taskDeleted", {
              subject: groupSenderName,
            })
          : updateChangeKind === "status"
            ? t("groupChat.taskHeader.updateStatus", {
                sender: groupSenderName,
              })
            : t("groupChat.taskHeader.updateDetail", {
                sender: groupSenderName,
              })
      : action === "create"
        ? ownerName
          ? t("orgTask.create.titleWithOwner", {
              ownerName,
            })
          : t("orgTask.create.title")
        : action === "delete"
          ? t("tools.deleted")
          : updateChangeKind === "status"
            ? t("orgTask.update.titleStatus")
            : t("orgTask.update.titleDetail"));

  // Subtitle: only populated when action is "update" + status changed.
  // Reads "Marked as [Pending|In Progress|Completed]" using the same
  // localized status label as the body chip. For create / detail updates
  // the card body's title row already conveys the change.
  const statusLabel =
    operationOutcome === "succeeded" && status
      ? t(`orgTask.status.${status}`, { defaultValue: status })
      : null;
  const headerSubtitle =
    action === "update" && statusChanged && statusLabel
      ? t("orgTask.update.markedAs", {
          status: statusLabel,
        })
      : null;

  return { headerTitle, headerSubtitle };
}
