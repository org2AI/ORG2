/**
 * Localizes branch-switch backend messages by their stable code. The backend
 * `message` is the English fallback for codes this build does not know, and
 * raw Git errors (`git_error`) are shown as Git wrote them.
 */
import i18n from "@src/i18n";

export interface BranchSwitchMessage {
  code?: string;
  message: string;
  detail?: string | null;
}

export function localizeBranchSwitchMessage(
  { code, message, detail }: BranchSwitchMessage,
  branch?: string
): string {
  if (!code || code === "git_error") return message;
  const key =
    code === "operation_in_progress" ? `operation_${detail ?? "other"}` : code;
  return i18n.t(`common:git.branchSwitch.messages.${key}`, {
    defaultValue: message,
    detail: detail ?? "",
    branch: branch ?? "",
  });
}
