import type { MobilePendingPermission, MobileSessionRow } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export function isSessionDisplay(value: unknown): boolean {
  return (
    value == null ||
    (record(value) &&
      Object.entries(value).every(
        ([key, field]) =>
          [
            "cliAgentType",
            "agentOrgId",
            "agentDefinitionId",
            "agentIconId",
            "model",
            "externalHistorySource",
          ].includes(key) &&
          typeof field === "string" &&
          field.length <= 512
      ))
  );
}

export function hasValidSessionPresentation(row: unknown): boolean {
  return (
    record(row) &&
    (row.mergeStatus == null ||
      (typeof row.mergeStatus === "string" && row.mergeStatus.length <= 64)) &&
    (row.lifecycleStatus == null ||
      (typeof row.lifecycleStatus === "string" &&
        row.lifecycleStatus.length <= 64)) &&
    isSessionDisplay(row.display)
  );
}

/** Reject malformed wire data at ingestion; never hide individual invalid rows. */
export function isSessionSearchRows(
  value: unknown
): value is MobileSessionRow[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (row: unknown) =>
        record(row) &&
        typeof row.id === "string" &&
        row.id.length > 0 &&
        typeof row.name === "string" &&
        typeof row.status === "string" &&
        ["running", "idle", "offline"].includes(row.status) &&
        hasValidSessionPresentation(row) &&
        (row.updatedAtMs == null || validDate(row.updatedAtMs)) &&
        (row.repoName == null || typeof row.repoName === "string")
    )
  );
}

export function isPendingPermissions(
  value: unknown
): value is MobilePendingPermission[] {
  return (
    Array.isArray(value) &&
    value.length <= 2000 &&
    value.every(
      (row: unknown) =>
        record(row) &&
        row.kind === "permission" &&
        typeof row.origin === "string" &&
        ["rust_agent", "cli_hook", "acp"].includes(row.origin) &&
        typeof row.sessionId === "string" &&
        row.sessionId.length > 0 &&
        typeof row.requestId === "string" &&
        row.requestId.length > 0 &&
        typeof row.toolName === "string" &&
        record(row.toolArgs) &&
        validDate(row.createdAtMs) &&
        (row.sessionName == null || typeof row.sessionName === "string") &&
        (row.toolCallId == null || typeof row.toolCallId === "string") &&
        (row.toolArgsTruncated == null ||
          typeof row.toolArgsTruncated === "boolean")
    )
  );
}
