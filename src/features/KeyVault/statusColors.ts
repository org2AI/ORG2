import type { TFunction } from "i18next";

import type { AccountStatus } from "@src/hooks/keyVault/types";

export const KEY_VAULT_STATUS_DOT: Record<string, string> = {
  ready: "bg-success-6",
  needs_setup: "bg-warning-6",
  error: "bg-danger-6",
  expired: "bg-warning-6",
  pending_approval: "bg-primary-6",
};

export function getAccountStatusLabel(
  status: AccountStatus,
  t: TFunction<"integrations">
): string {
  switch (status) {
    case "ready":
      return t("status.ready");
    case "needs_setup":
      return t("status.needsSetup");
    case "error":
      return t("status.error");
    case "expired":
      return t("status.expired");
    case "pending_approval":
      return t("status.pendingApproval");
    default:
      return status;
  }
}
