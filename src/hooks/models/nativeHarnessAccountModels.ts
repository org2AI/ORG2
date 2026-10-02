import {
  CLI_AGENT,
  NATIVE_HARNESS_TYPE,
} from "@src/api/tauri/rpc/schemas/validation";
import type { NativeHarnessType } from "@src/api/types/keys";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";

const MY_KEY_FALLBACK_NATIVE_MODELS: Record<
  NativeHarnessType,
  readonly string[]
> = {
  [NATIVE_HARNESS_TYPE.CURSOR]: ["composer-2"],
};

export function getMyKeyFallbackNativeModels(
  nativeHarnessType: NativeHarnessType
): string[] {
  return [...MY_KEY_FALLBACK_NATIVE_MODELS[nativeHarnessType]];
}

export function isCursorNativeAccount(account: KeyVaultAccount): boolean {
  return (
    account.modelType === CLI_AGENT.CURSOR &&
    account.hasSessionToken &&
    account.enabled &&
    (account.canUseNativeHarness ||
      account.nativeHarnessType === NATIVE_HARNESS_TYPE.CURSOR)
  );
}

export function isClaudeCodeOAuthAccount(account: KeyVaultAccount): boolean {
  return (
    account.modelType === CLI_AGENT.CLAUDE_CODE &&
    account.hasSessionToken &&
    account.enabled &&
    account.authMethod === "oauth"
  );
}

export function isCodexOAuthAccount(account: KeyVaultAccount): boolean {
  return (
    account.modelType === CLI_AGENT.CODEX &&
    account.hasSessionToken &&
    account.enabled &&
    account.authMethod === "oauth"
  );
}

export function withCursorNativeModels(
  account: KeyVaultAccount
): KeyVaultAccount {
  // `enabledModels` is the user's source of truth and is forwarded as-is.
  // `availableModels` may be seeded from the fallback list when dynamic
  // discovery has not yet populated the account, so picker UIs always have
  // something to render.
  const availableModels = new Set(account.availableModels ?? []);

  if (availableModels.size === 0) {
    for (const modelId of getMyKeyFallbackNativeModels(
      NATIVE_HARNESS_TYPE.CURSOR
    )) {
      availableModels.add(modelId);
    }
  }

  return {
    ...account,
    canUseNativeHarness: true,
    nativeHarnessType: account.nativeHarnessType ?? NATIVE_HARNESS_TYPE.CURSOR,
    availableModels: Array.from(availableModels),
    enabledModels: account.enabledModels ?? [],
  };
}

export function withClaudeCodeOAuthModels(
  account: KeyVaultAccount
): KeyVaultAccount {
  return account;
}

export function withCodexOAuthModels(
  account: KeyVaultAccount
): KeyVaultAccount {
  return account;
}

export function withNativeHarnessModels(
  accounts: KeyVaultAccount[],
  dispatchCategory: string | null
): KeyVaultAccount[] {
  if (dispatchCategory !== "rust_agent") return accounts;
  return accounts.map((account) => {
    if (isCursorNativeAccount(account)) return withCursorNativeModels(account);
    if (isClaudeCodeOAuthAccount(account))
      return withClaudeCodeOAuthModels(account);
    if (isCodexOAuthAccount(account)) return withCodexOAuthModels(account);
    return account;
  });
}
