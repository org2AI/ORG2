/**
 * Refresh the available-models list for a single Key Vault account.
 *
 * Dispatches per provider:
 *   • Cursor (with session token) → cursor_list_models_native
 *   • Claude Code / Codex OAuth   → oauth_model_catalog
 *   • Anything else (API key)     → validate_key (validator already returns
 *                                   models_available alongside the auth check)
 *
 * For OAuth providers we apply a "narrow-path 401 retry": if the list-models
 * call rejects with HTTP 401, force a token refresh via the existing per-key
 * locked refresh helpers (refresh_oauth_token Tauri command) and retry the
 * list call exactly once. This piggybacks on the same refresh function that
 * the agent runtime uses on 401 — it does not introduce a new refresh entry
 * point or any user-triggered token churn beyond what the runtime already
 * performs reactively.
 *
 * On success, writes the discovered model list back to the key store via
 * refreshKeyModelCatalog (preserving the latest health and enabled choices —
 * new models default to "addable", never auto-enabled). OAuth refresh health
 * remains owned by the backend's credential-generation-checked write path.
 */
import {
  type FullKeyResponse,
  type ModelContextLengths,
  getCursorNativeModels,
  getFullKey,
  getOAuthModelCatalog,
  refreshKeyModelCatalog,
  refreshOauthToken,
  validateKey,
} from "@src/api/services/keyValidation";
import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validation";
import type { DefaultVariantInfo, ModelVariantInfo } from "@src/api/types/keys";
import type { KeyVaultAccount } from "@src/hooks/keyVault";

/**
 * Sentinel: caller can branch on this if it wants to show "please re-add this
 * account" instead of a generic toast. Currently we just surface the error
 * message and mark the key invalid; the UI uses the message string.
 */
export class RefreshModelsError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth_expired" | "transient" | "unsupported"
  ) {
    super(message);
    this.name = "RefreshModelsError";
  }
}

function isUnauthorizedError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  // Backend list-models commands stringify HTTP status into the error message
  // (e.g. "Claude Code OAuth model discovery failed: HTTP 401: ..."). Match
  // 401 anywhere in the message — providers vary in their exact phrasing but
  // all include the numeric status.
  return /\b401\b|unauthorized|invalid_grant|token.*expired/i.test(message);
}

function isOAuthAccount(account: KeyVaultAccount): boolean {
  return account.authMethod === "oauth";
}

interface FetchedAccountModels {
  models: string[];
  modelContextLengths: ModelContextLengths;
  modelVariants?: ModelVariantInfo[];
  defaultVariants?: DefaultVariantInfo[];
}

async function fetchOAuthCatalogForAccount(
  account: KeyVaultAccount,
  accessToken: string,
  envVars: Record<string, string> | undefined
): Promise<FetchedAccountModels> {
  const catalog = await getOAuthModelCatalog(account.modelType, {
    accessToken,
    refreshToken:
      account.modelType === CLI_AGENT.CLAUDE_CODE
        ? envVars?.CLAUDE_CODE_REFRESH_TOKEN
        : envVars?.OPENAI_REFRESH_TOKEN,
    idToken: envVars?.OPENAI_ID_TOKEN ?? envVars?.CODEX_ID_TOKEN,
  });
  // A stored account is already a better last-known-good source than the
  // baked bootstrap list. Never replace it when live discovery is unavailable.
  if (catalog.source !== "live") {
    throw new RefreshModelsError(
      "Live model discovery is temporarily unavailable",
      "transient"
    );
  }
  return {
    models: catalog.models,
    modelContextLengths: catalog.modelContextLengths,
    modelVariants: catalog.modelVariants,
    defaultVariants: catalog.defaultVariants,
  };
}

interface AccountModelDiscovery extends FetchedAccountModels {
  snapshot: FullKeyResponse;
}

async function fetchModelsForAccount(
  account: KeyVaultAccount
): Promise<AccountModelDiscovery> {
  const snapshot = await getFullKey(account.modelType, account.id);
  if (!snapshot) {
    throw new RefreshModelsError(
      `Key not found for account ${account.id}`,
      "transient"
    );
  }
  return { ...(await discoverModelsForAccount(account, snapshot)), snapshot };
}

async function discoverModelsForAccount(
  account: KeyVaultAccount,
  fullKey: FullKeyResponse
): Promise<FetchedAccountModels> {
  switch (account.modelType) {
    case CLI_AGENT.CURSOR: {
      const token = fullKey.session_token;
      if (!token) {
        throw new RefreshModelsError(
          "Cursor account has no session token",
          "unsupported"
        );
      }
      return {
        models: await getCursorNativeModels(token),
        modelContextLengths: {},
      };
    }
    case CLI_AGENT.CLAUDE_CODE: {
      if (!isOAuthAccount(account)) {
        // Claude API key path falls through to validateKey below.
        break;
      }
      const token = fullKey.session_token;
      if (!token) {
        throw new RefreshModelsError(
          "Claude Code OAuth account has no access token",
          "auth_expired"
        );
      }
      return fetchOAuthCatalogForAccount(account, token, fullKey.env_vars);
    }
    case CLI_AGENT.CODEX: {
      if (!isOAuthAccount(account)) {
        break;
      }
      const token = fullKey.session_token;
      if (!token) {
        throw new RefreshModelsError(
          "Codex OAuth account has no access token",
          "auth_expired"
        );
      }
      return fetchOAuthCatalogForAccount(account, token, fullKey.env_vars);
    }
  }

  // Default path: API key providers (OpenAI, Anthropic, Gemini BYOK, Groq,
  // xAI, DeepSeek, custom base_url, …). The validator's /v1/models call
  // returns the model catalog alongside the auth check.
  const apiKey = fullKey.api_key;
  if (!apiKey) {
    throw new RefreshModelsError(
      `Account ${account.modelType} has no API key`,
      "unsupported"
    );
  }
  const result = await validateKey(
    account.modelType,
    apiKey,
    fullKey.base_url ?? undefined
  );
  if (!result.valid) {
    throw new RefreshModelsError(
      result.message || "Key validation failed",
      "auth_expired"
    );
  }
  return {
    models: result.models_available ?? [],
    modelContextLengths: result.model_context_lengths,
  };
}

export interface RefreshAccountModelsResult {
  /** Available models after the refresh. */
  models: string[];
  /** Available models before the refresh (for computing added/removed). */
  previousModels: string[];
}

async function performAccountModelsRefresh(
  account: KeyVaultAccount
): Promise<RefreshAccountModelsResult> {
  let fetched: AccountModelDiscovery;

  try {
    fetched = await fetchModelsForAccount(account);
  } catch (firstErr) {
    // Narrow-path 401 retry: only for OAuth accounts, only once. Uses the
    // same per-provider refresh helpers that the agent runtime calls on 401
    // — backend takes a per-key lock so repeated user clicks don't cascade.
    if (isOAuthAccount(account) && isUnauthorizedError(firstErr)) {
      try {
        await refreshOauthToken(account.id);
      } catch (refreshErr) {
        // OAuth refresh already records health at its guarded backend boundary.
        // A late catalog request must not mark replacement credentials invalid.
        throw new RefreshModelsError(
          refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
          isUnauthorizedError(refreshErr) ? "auth_expired" : "transient"
        );
      }
      try {
        fetched = await fetchModelsForAccount(account);
      } catch (retryErr) {
        throw retryErr instanceof RefreshModelsError
          ? retryErr
          : new RefreshModelsError(
              retryErr instanceof Error ? retryErr.message : String(retryErr),
              isUnauthorizedError(retryErr) ? "auth_expired" : "transient"
            );
      }
    } else {
      throw firstErr instanceof RefreshModelsError
        ? firstErr
        : new RefreshModelsError(
            firstErr instanceof Error ? firstErr.message : String(firstErr),
            "transient"
          );
    }
  }

  if (fetched.models.length === 0) {
    throw new RefreshModelsError(
      "Provider returned an empty model list",
      "transient"
    );
  }

  const saved = await refreshKeyModelCatalog(account.id, {
    expectedCredentialGeneration: fetched.snapshot.credential_generation,
    expectedCatalogGeneration: fetched.snapshot.model_catalog_generation,
    availableModels: fetched.models,
    modelVariants: fetched.modelVariants ?? null,
    defaultVariants: fetched.defaultVariants ?? null,
    modelContextLengths: fetched.modelContextLengths,
  });
  if (!saved) {
    throw new RefreshModelsError("Account no longer exists", "transient");
  }
  return {
    models: saved.available_models,
    previousModels: fetched.snapshot.available_models,
  };
}

// Retained only while a user-requested refresh is active; both entry points
// share discovery and release the promise on success or failure.
const pendingRefreshes = new Map<string, Promise<RefreshAccountModelsResult>>();

export function refreshAccountModels(
  account: KeyVaultAccount
): Promise<RefreshAccountModelsResult> {
  const pending = pendingRefreshes.get(account.id);
  if (pending) return pending;
  const refresh = performAccountModelsRefresh(account).finally(() => {
    if (pendingRefreshes.get(account.id) === refresh)
      pendingRefreshes.delete(account.id);
  });
  pendingRefreshes.set(account.id, refresh);
  return refresh;
}

export interface RefreshAllAccountModelsSummary {
  /** Number of accounts attempted. */
  total: number;
  /** Number of accounts whose refresh rejected. */
  failed: number;
  /** Distinct model ids that appeared after refresh (across all accounts). */
  added: number;
  /** Distinct model ids that disappeared after refresh (across all accounts). */
  removed: number;
}

/**
 * Refresh models for every provided account in parallel and tally the net
 * added/removed models across all of them. Single shared pipeline used by both
 * the Key Vault models table and the model spotlight refresh buttons — do not
 * re-implement the loop at call sites.
 */
export async function refreshAllAccountModels(
  accounts: KeyVaultAccount[]
): Promise<RefreshAllAccountModelsSummary> {
  const results = await Promise.allSettled(
    accounts.map((account) => refreshAccountModels(account))
  );

  let failed = 0;
  let added = 0;
  let removed = 0;

  for (const result of results) {
    if (result.status === "rejected") {
      failed += 1;
      continue;
    }
    const before = new Set(result.value.previousModels);
    const after = new Set(result.value.models);
    for (const model of after) {
      if (!before.has(model)) added += 1;
    }
    for (const model of before) {
      if (!after.has(model)) removed += 1;
    }
  }

  return { total: accounts.length, failed, added, removed };
}

type RefreshSummaryTranslate = (
  key: string,
  options?: Record<string, unknown>
) => string;

/**
 * Which Message tone to use for a refresh summary: `warning` when any account
 * failed, otherwise `success`. Shared so every refresh entry point renders the
 * same toast semantics.
 */
export function refreshSummaryTone(
  summary: RefreshAllAccountModelsSummary
): "success" | "warning" {
  return summary.failed > 0 ? "warning" : "success";
}

/**
 * Human-readable toast text for a refresh summary, reporting how many models
 * were added / removed (and how many accounts failed, if any). Single source of
 * truth for both the Key Vault table and the model spotlight.
 */
export function formatRefreshSummary(
  summary: RefreshAllAccountModelsSummary,
  t: RefreshSummaryTranslate
): string {
  const { added, removed, failed, total } = summary;
  if (failed > 0) {
    return t("keyVault.toasts.refreshPartial", {
      failed,
      total,
      added,
      removed,
    });
  }
  if (added === 0 && removed === 0) {
    return t("keyVault.toasts.refreshedNoChange");
  }
  return t("keyVault.toasts.refreshedDelta", { added, removed });
}
