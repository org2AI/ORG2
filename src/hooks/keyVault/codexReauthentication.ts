const CODEX_REAUTHENTICATION_SIGNALS = [
  "refresh_token_reused",
  "refresh token has already been used",
  "try signing in again",
  "invalid_grant",
] as const;

/** Whether retrying cannot recover and the Codex OAuth account must reconnect. */
export function requiresCodexReauthentication(raw: string): boolean {
  const message = raw.toLowerCase();
  if (!message || !message.includes("codex")) return false;

  return CODEX_REAUTHENTICATION_SIGNALS.some((signal) =>
    message.includes(signal)
  );
}
