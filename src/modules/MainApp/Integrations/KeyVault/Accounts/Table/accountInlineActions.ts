import { REAUTH_AGENTS, type ReauthAgent } from "@src/config/mainAppPaths";
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
 * The agent whose reconnect flow repairs this account in place, if any: a
 * failed local OAuth credential of an agent the Key Vault can reauthenticate.
 * API-key rows and manually disabled healthy rows use their existing edit flow.
 */
export function reconnectableOAuthAgent(
  account: ReconnectableAccount
): ReauthAgent | null {
  if (
    !account.hasLocalKey ||
    account.authMethod !== "oauth" ||
    !(account.status === "error" || account.healthStatus === "invalid")
  ) {
    return null;
  }
  return REAUTH_AGENTS.find((agent) => agent === account.modelType) ?? null;
}
