/**
 * Token/context usage projection for Rust agent sessions: post-load context
 * snapshots, token usage info for the completion callback, and the terminal
 * usage-telemetry refresh applied to the latest EventStore rows.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { ContextUsageSnapshot } from "@src/store/session/cliSessionStatusAtom";

import type { AgentTokenUsageInfo } from "../../types";
import type { AgentTokenUsage } from "../shared/types";
import {
  applyLlmUsageToEvents,
  applyToolUsageToEvents,
  loadUsageTelemetry,
} from "./toolUsageCache";

export interface TokenUsageRecord {
  usagePurpose?: string | null;
  inputTokens: number;
  contextTokens: number;
  contextUsageJson?: string | null;
}

function parseContextUsageSnapshot(
  raw: string | null | undefined
): ContextUsageSnapshot | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ContextUsageSnapshot;
  } catch {
    return undefined;
  }
}

export function getLatestContextUsageSnapshot(
  records: readonly {
    contextUsageJson?: string | null;
    usagePurpose?: string | null;
  }[]
): ContextUsageSnapshot | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]?.usagePurpose) continue;
    const contextUsage = parseContextUsageSnapshot(
      records[index]?.contextUsageJson
    );
    if (contextUsage) return contextUsage;
  }
  return undefined;
}

/** Auxiliary tokens belong in lifetime usage, not the main context ring. */
export function getLatestForegroundUsage(
  records: readonly TokenUsageRecord[]
): TokenUsageRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (!records[index].usagePurpose) return records[index];
  }
  return undefined;
}

export function toTokenUsageInfo(usage: AgentTokenUsage): AgentTokenUsageInfo {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    contextTokens: usage.contextTokens,
    ...(usage.contextUsage ? { contextUsage: usage.contextUsage } : {}),
    ...(usage.contextBreakdown
      ? { contextBreakdown: usage.contextBreakdown }
      : {}),
  };
}

export async function refreshUsageForLatestEvents(
  sessionId: string
): Promise<void> {
  const { toolUsageByCallId, llmUsageByTurnId } =
    await loadUsageTelemetry(sessionId);
  if (toolUsageByCallId.size === 0 && llmUsageByTurnId.size === 0) return;

  const snapshot = eventStoreProxy.getLatestSessionSnapshot(sessionId);
  const events = snapshot?.chatEvents ?? [];
  const hydratedEvents = applyLlmUsageToEvents(
    applyToolUsageToEvents(events, toolUsageByCallId),
    llmUsageByTurnId
  );
  const updates = hydratedEvents.flatMap((event, index) => {
    if (event.args === events[index]?.args) return [];
    return [
      eventStoreProxy.updateById(event.id, { args: event.args }, sessionId),
    ];
  });
  await Promise.all(updates);
}
