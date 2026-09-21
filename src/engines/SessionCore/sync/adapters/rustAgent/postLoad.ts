/**
 * Post-load projection for a Rust agent session: restore the durable run
 * status (verified against the live runtime) and the latest token usage.
 */
import { getSession, getSessionInfo } from "@src/api/tauri/agent";
import { createLogger } from "@src/hooks/logger";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { isSessionEngineActiveStatus } from "@src/util/session/sessionRuntimeExecuting";

import type { PostLoadResult } from "../../types";
import {
  type TokenUsageRecord,
  getLatestContextUsageSnapshot,
  getLatestForegroundUsage,
} from "./usageProjection";

const logger = createLogger("RustAgentAdapter");

export async function loadRustAgentPostLoadResult(
  sessionId: string,
  signal: AbortSignal,
  options: { category: string; tokenUsageCommand?: string }
): Promise<PostLoadResult> {
  const { category, tokenUsageCommand } = options;
  const result: PostLoadResult = {};

  // Restore session status from DB so the UI reflects the correct
  // terminal state when switching to a completed/failed session.
  try {
    const record = await getSession(sessionId);
    if (signal.aborted) return result;
    if (record?.status && record.status !== "idle") {
      const isInFlight = isSessionEngineActiveStatus(record.status);

      if (isInFlight) {
        // DB says in-flight — verify against the Rust runtime HashMap.
        // If the session is not alive (crash recovery, idle eviction,
        // IPC channel drop that lost agent:complete), override to idle
        // so the frontend doesn't show a phantom active session.
        const info = await getSessionInfo(sessionId);
        if (signal.aborted) return result;
        if (!info) {
          logger.warn(
            `[${category}] postLoad: DB says "${record.status}" but session not in Rust runtime — treating as idle`
          );
          result.runStatus = "idle";
        } else {
          result.runStatus = record.status;
        }
      } else {
        result.runStatus = record.status;
        if (
          (record.status === "failed" || record.status === "error") &&
          record.errorMessage
        ) {
          result.runError = record.errorMessage;
        }
      }
    }
  } catch (err) {
    logger.warn(`[${category}] postLoad session fetch failed:`, err);
  }

  if (signal.aborted) return result;

  // Token usage — SDE agent only
  if (!tokenUsageCommand) return result;

  try {
    const records = await invokeTauri<TokenUsageRecord[]>(tokenUsageCommand, {
      sessionId,
    });
    if (signal.aborted) return result;
    if (records?.length) {
      const last = getLatestForegroundUsage(records);
      if (last) {
        const fill =
          last.contextTokens > 0 ? last.contextTokens : last.inputTokens;
        if (fill > 0) result.contextTokens = fill;
      }
      const contextUsage = getLatestContextUsageSnapshot(records);
      if (contextUsage) result.contextUsage = contextUsage;
    }
  } catch (err) {
    logger.warn(`[${category}] postLoad token fetch failed:`, err);
  }

  return result;
}
