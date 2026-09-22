/**
 * How an account was added, persisted on the key as account metadata so that
 * reconnecting offers the same method again. Mirrors
 * `ACCOUNT_SETUP_METHOD_METADATA_KEY` in the key-vault crate, which also reads
 * it to tell a login copied from another tool from one the vault owns.
 */
export const ACCOUNT_SETUP_METHOD_METADATA_KEY = "setup_method";

/** Setup methods each reconnectable agent's wizard step offers, default first. */
const RECONNECT_SETUP_METHODS = {
  codex: ["signin", "autodetect", "enter_token"],
  claude_code: ["signin", "autodetect"],
} as const;

export type ReconnectableAgent = keyof typeof RECONNECT_SETUP_METHODS;

/**
 * The method a reconnect opens on: the one the account was added with.
 * Accounts saved before the method was recorded, or recorded with a method the
 * agent does not offer, fall back to sign-in.
 */
export function reconnectSetupMethod(
  agent: ReconnectableAgent,
  account: { accountMetadata?: Record<string, string> } | undefined
): string {
  const methods: readonly string[] = RECONNECT_SETUP_METHODS[agent];
  const recorded =
    account?.accountMetadata?.[ACCOUNT_SETUP_METHOD_METADATA_KEY];
  return recorded !== undefined && methods.includes(recorded)
    ? recorded
    : methods[0];
}

/**
 * Account metadata to save for a wizard submission, with the setup method the
 * user actually went through. `defaultMethod` is what the agent's setup step
 * shows when the user never touched the method selector.
 */
export function withRecordedSetupMethod(
  metadata: Record<string, string> | undefined,
  setupMethod: string | undefined,
  defaultMethod: string | undefined
): Record<string, string> | undefined {
  const method = setupMethod ?? defaultMethod;
  if (!method) {
    return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
  }
  return { ...metadata, [ACCOUNT_SETUP_METHOD_METADATA_KEY]: method };
}
