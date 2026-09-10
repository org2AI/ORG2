import type { KeyInfo } from "@src/api/services/keyValidation";

import {
  getSharedLocalKeys,
  subscribeSharedLocalKeys,
} from "./sharedLocalKeyStore";

/** Ignore health/quota publications: only account identity and display changes
 * invalidate history. This is a notification key, never a credential scope. */
export function weeklyQuotaAccountSignature(keys: KeyInfo[]): string {
  return JSON.stringify(
    keys
      .filter((key) =>
        ["claude_code", "codex", "opencode"].includes(key.agent_type)
      )
      .map((key) => [
        key.id,
        key.agent_type,
        key.name,
        key.enabled,
        key.auth_method,
        key.base_url,
        key.created_at,
        key.session_token_preview,
        key.api_key_preview,
        key.has_session_token,
        key.has_api_key,
        [
          "account_id",
          "email",
          "user_id",
          "organization_uuid",
          "opencode_workspace_id",
        ].map((field) => key.account_metadata?.[field]),
        Object.entries(key.env_vars_masked ?? {}).sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
}

export function currentWeeklyQuotaAccountSignature(): string {
  return weeklyQuotaAccountSignature(getSharedLocalKeys());
}

export function subscribeWeeklyQuotaAccountChanges(
  listener: (signature: string) => void
) {
  let signature = currentWeeklyQuotaAccountSignature();
  return subscribeSharedLocalKeys((keys) => {
    const next = weeklyQuotaAccountSignature(keys);
    if (signature === next) return;
    signature = next;
    listener(next);
  });
}
