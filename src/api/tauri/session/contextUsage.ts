import { invoke } from "@tauri-apps/api/core";

import type { ContextUsageSnapshot } from "@src/store/session/cliSessionStatusAtom";

// Local rollout reads only; entries exist only during the request and are bounded.
const contextReads = new Map<string, Promise<ContextUsageSnapshot | null>>();
const MAX_CONTEXT_READS = 8;

/** Fresh, bounded source read; never substitutes cumulative billing totals. */
export function readSourceContextUsage(
  command:
    | "codex_app_context_usage"
    | "claude_code_context_usage"
    | "cli_agent_context_usage",
  sessionId: string
): Promise<ContextUsageSnapshot | null> {
  const key = `${command}:${sessionId}`;
  const existing = contextReads.get(key);
  if (existing) return existing;
  if (contextReads.size >= MAX_CONTEXT_READS) {
    return Promise.reject(
      new Error("Context reads busy; retry when current reads finish")
    );
  }
  const request = invoke<ContextUsageSnapshot | null>(command, {
    sessionId,
  }).finally(() => {
    contextReads.delete(key);
  });
  contextReads.set(key, request);
  return request;
}

export function cliSessionContextUsage(sessionId: string) {
  return readSourceContextUsage("cli_agent_context_usage", sessionId);
}
