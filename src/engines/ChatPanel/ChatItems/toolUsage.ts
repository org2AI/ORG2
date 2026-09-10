import {
  type SessionEvent,
  TOOL_USAGE_ARGS_KEY,
  type ToolUsageMetadata,
} from "@src/engines/SessionCore/core/types";

/**
 * Reads the per-tool usage attached to an event, preferring the typed field
 * and falling back to the raw args slot the Rust adapter writes into.
 */
export function readToolUsage(
  event: SessionEvent
): ToolUsageMetadata | undefined {
  if (event.toolUsage) return event.toolUsage;
  const raw = event.args?.[TOOL_USAGE_ARGS_KEY];
  if (!raw || typeof raw !== "object") return undefined;
  return raw as ToolUsageMetadata;
}

/**
 * Sums tool usage across a group of events. Entries without usage are
 * ignored; returns `undefined` when nothing contributed. When the
 * contributing entries disagree on `attributionMethod`, the last one wins.
 */
export function sumToolUsage(
  usages: ReadonlyArray<ToolUsageMetadata | undefined>
): ToolUsageMetadata | undefined {
  const present = usages.filter((usage): usage is ToolUsageMetadata =>
    Boolean(usage)
  );
  if (present.length === 0) return undefined;

  return present.reduce<ToolUsageMetadata>(
    (total, usage) => ({
      decisionCompletionTokens:
        total.decisionCompletionTokens + usage.decisionCompletionTokens,
      resultContextTokens:
        total.resultContextTokens + usage.resultContextTokens,
      followupCompletionTokens:
        total.followupCompletionTokens + usage.followupCompletionTokens,
      inputBytes: total.inputBytes + usage.inputBytes,
      outputBytes: total.outputBytes + usage.outputBytes,
      relatedCacheReadTokens:
        total.relatedCacheReadTokens + usage.relatedCacheReadTokens,
      relatedCacheWriteTokens:
        total.relatedCacheWriteTokens + usage.relatedCacheWriteTokens,
      attributionMethod:
        total.attributionMethod === usage.attributionMethod
          ? total.attributionMethod
          : usage.attributionMethod,
    }),
    {
      decisionCompletionTokens: 0,
      resultContextTokens: 0,
      followupCompletionTokens: 0,
      inputBytes: 0,
      outputBytes: 0,
      relatedCacheReadTokens: 0,
      relatedCacheWriteTokens: 0,
      attributionMethod: present[0].attributionMethod,
    }
  );
}
