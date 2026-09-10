import type { KeyVaultAccount } from "@src/hooks/keyVault";

type ReconnectableAccount = Pick<
  KeyVaultAccount,
  "authMethod" | "hasLocalKey" | "healthStatus" | "modelType" | "status"
>;

export function areAccountRefreshActionsDisabled(
  refreshingUsage: boolean,
  refreshingModels: boolean
): boolean {
  return refreshingUsage || refreshingModels;
}

/**
 * Codex browser reauthentication updates an existing local OAuth credential.
 * API-key rows and manually disabled healthy rows use their existing edit flow.
 */
export function shouldShowCodexReconnect(
  account: ReconnectableAccount
): boolean {
  return (
    account.hasLocalKey &&
    account.modelType === "codex" &&
    account.authMethod === "oauth" &&
    (account.status === "error" || account.healthStatus === "invalid")
  );
}
