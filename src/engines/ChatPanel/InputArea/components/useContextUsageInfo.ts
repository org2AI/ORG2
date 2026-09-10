import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useKeyVault } from "@src/hooks/keyVault";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import type { ContextUsageSnapshot } from "@src/store/session/cliSessionStatusAtom";
import {
  sessionContextTokensAtom,
  sessionContextUsageAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { getModelInfo } from "@src/types/model/info";
import {
  type ResolvedModelVariantFields,
  getModelVariantBaseModel,
} from "@src/util/modelVariants";
import { isCliSession } from "@src/util/session/sessionDispatch";

type ContextWindowVariant = Pick<
  ResolvedModelVariantFields,
  "model" | "base_model" | "context_window"
>;

function positiveContextWindow(
  variant: ContextWindowVariant | undefined
): number | null {
  const contextWindow = variant?.context_window;
  return typeof contextWindow === "number" && contextWindow > 0
    ? contextWindow
    : null;
}

/**
 * Resolve provider metadata for an ORG2 model variant. A variant-specific
 * value wins; otherwise synthetic effort variants inherit the base model's
 * provider-reported window.
 */
export function resolveAccountContextWindow(
  modelName: string,
  variants: readonly ContextWindowVariant[] | undefined
): number | null {
  if (!modelName || !variants) return null;

  const exactVariant = variants.find((variant) => variant.model === modelName);
  const exactContextWindow = positiveContextWindow(exactVariant);
  if (exactContextWindow !== null) return exactContextWindow;

  const metadataBaseModel = exactVariant?.base_model;
  const baseModel =
    metadataBaseModel && metadataBaseModel !== modelName
      ? metadataBaseModel
      : getModelVariantBaseModel(modelName);
  if (baseModel === modelName) return null;

  return positiveContextWindow(
    variants.find((variant) => variant.model === baseModel)
  );
}

export interface ContextUsageInfo {
  percentage: number;
  clampedPercentage: number;
  tokenLabel: string;
  maxTokens: number;
  displayTokens: number;
  contextUsage: ContextUsageSnapshot | null;
  /** Cache-read tokens saved by Anthropic prompt caching (not counted as used). */
  cacheReadTokens: number;
  /** Cache-write tokens written this turn. */
  cacheWriteTokens: number;
  /** Remaining available tokens (maxTokens - displayTokens excluding cache). */
  remainingTokens: number;
  /**
   * Prompt-cache hit rate in [0, 1]: `cacheRead / (cacheRead + billableInput)`.
   * Matches the backend `cache_hit_rate` cost metric — at 0.9 the prompt costs
   * ~10% of full price. 0 when there is no cache activity.
   */
  cacheHitRate: number;
  /** Tokens served from cache this turn (i.e. cacheReadTokens), surfaced as savings. */
  cacheSavedTokens: number;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

/**
 * Prompt-cache hit rate `cacheRead / (cacheRead + billableInput)`.
 *
 * Mirrors the Rust `cache_hit_rate` helper. `billableInput` is the
 * non-cached input the provider charged full price for this turn. Returns 0
 * when both inputs are zero (no usage yet) so it is safe to render
 * unconditionally.
 */
export function computeCacheHitRate(
  cacheReadTokens: number,
  billableInputTokens: number
): number {
  const denom = Math.max(0, cacheReadTokens) + Math.max(0, billableInputTokens);
  if (denom <= 0) return 0;
  return Math.max(0, cacheReadTokens) / denom;
}

/** External sources must supply their own window; the composer's model is unrelated. */
export function resolveContextMaxTokens(
  reported: number | null | undefined,
  modelMaxTokens: number,
  external: boolean
): number {
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0)
    return reported;
  return external ? 0 : modelMaxTokens;
}

export function useContextUsageInfo(): ContextUsageInfo {
  const { t } = useTranslation();
  const { sessionId } = useSessionId();
  const external =
    !!getImportedHistorySourceBySessionId(sessionId) ||
    (!!sessionId && isCliSession(sessionId));
  const sessionTokens = useAtomValue(sessionContextTokensAtom);
  const contextUsage = useAtomValue(sessionContextUsageAtom);
  const lastModel = useValidatedLastPair();
  const { accounts } = useKeyVault({ autoLoad: true });

  const modelName = lastModel?.model || lastModel?.listingModel || "";
  const modelInfo = useMemo(
    () => (modelName ? getModelInfo(modelName) : null),
    [modelName]
  );
  const accountContextWindow = useMemo(() => {
    const accountId = lastModel?.selectedAccountId;
    if (!modelName || !accountId) return null;
    const account = accounts.find((entry) => entry.id === accountId);
    return resolveAccountContextWindow(modelName, account?.modelVariants);
  }, [accounts, lastModel?.selectedAccountId, modelName]);
  const contextWindowK = modelInfo?.contextWindow ?? 200;
  const modelMaxTokens = accountContextWindow ?? contextWindowK * 1000;
  const maxTokens = resolveContextMaxTokens(
    contextUsage?.maxTokens,
    modelMaxTokens,
    external
  );
  const snapshotTokens = contextUsage?.usedTokens ?? 0;
  const displayTokens = sessionTokens > 0 ? sessionTokens : snapshotTokens;
  const hasFreshSnapshot = contextUsage?.usedTokens === displayTokens;
  const percentage =
    hasFreshSnapshot && contextUsage?.percentUsed != null
      ? contextUsage.percentUsed
      : maxTokens > 0
        ? (displayTokens / maxTokens) * 100
        : 0;
  const clampedPercentage = Math.min(percentage, 100);

  const tokenLabel =
    external && (!contextUsage || !maxTokens)
      ? `${t("common:status.unknown")} · ${contextUsage ? formatTokenCount(displayTokens) : "—"} / — ${t("contextInfo.contextUsed")}`
      : `${percentage.toFixed(1)}% · ${formatTokenCount(displayTokens)} / ${formatTokenCount(maxTokens)} ${t("contextInfo.contextUsed")}`;

  const cacheReadTokens = contextUsage?.cacheReadTokens ?? 0;
  const cacheWriteTokens = contextUsage?.cacheWriteTokens ?? 0;
  const remainingTokens = Math.max(0, maxTokens - displayTokens);

  // displayTokens (== last_prompt) = billableInput + cacheRead + cacheWrite,
  // so the non-cached input the provider charged full price for is the
  // remainder. The hit-rate denominator is cacheRead + billableInput.
  const billableInputTokens = Math.max(
    0,
    displayTokens - cacheReadTokens - cacheWriteTokens
  );
  const cacheHitRate = computeCacheHitRate(
    cacheReadTokens,
    billableInputTokens
  );
  const cacheSavedTokens = cacheReadTokens;

  return {
    percentage,
    clampedPercentage,
    tokenLabel,
    maxTokens,
    displayTokens,
    contextUsage,
    cacheReadTokens,
    cacheWriteTokens,
    remainingTokens,
    cacheHitRate,
    cacheSavedTokens,
  };
}
