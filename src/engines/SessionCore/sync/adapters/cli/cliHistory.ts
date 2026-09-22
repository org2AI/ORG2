import { convertFileSrc } from "@tauri-apps/api/core";

import { rpc } from "@src/api/tauri/rpc";
import { cliSessionContextUsage } from "@src/api/tauri/session/contextUsage";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";
import type { CliSessionStatus } from "@src/types/session/session";
import {
  imageRefToRustPath,
  isDirectImageUrl,
  parseTranscriptImageRef,
} from "@src/util/file/imageRefs";

import type { PostLoadResult } from "../../types";

const log = createLogger("CliAdapter");

interface StoredSession {
  status: string;
  errorMessage?: string | null;
  /** 'chunks' (legacy DB transcript) or 'native' (CLI's own store). */
  transcriptSource?: string;
}

export function convertResultImages(event: SessionEvent): SessionEvent {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result?.images || !Array.isArray(result.images)) return event;
  const converted = (result.images as string[]).map((imgRef) =>
    isDirectImageUrl(imgRef) || parseTranscriptImageRef(imgRef)
      ? imgRef
      : convertFileSrc(imageRefToRustPath(imgRef))
  );
  return { ...event, result: { ...result, images: converted } };
}

// Only pending reads are shared; no transcript bodies survive completion.
// Revision keys include the account-scoped file binding, so a profile switch
// cannot join a pending read from a different native store.
const inFlightHistory = new Map<string, Promise<SessionEvent[]>>();
const MAX_TRACKED_READS = 8;

async function loadHistory(
  sessionId: string,
  signal: AbortSignal,
  kind: "full" | "preview"
): Promise<SessionEvent[]> {
  if (signal.aborted) return [];
  // This probe only permits safe coalescing. Its failure must not make a
  // readable transcript unavailable; read independently without a cache key.
  const revision = await loadCliTranscriptRevision(sessionId).catch(() => null);
  if (signal.aborted) return [];
  const key = revision ? JSON.stringify([sessionId, kind, revision]) : null;
  let request = key ? inFlightHistory.get(key) : undefined;
  if (!request) {
    request = rpc.cli
      .history({ sessionId, read: { kind } })
      .then((events) => events.map(convertResultImages));
    if (key && inFlightHistory.size < MAX_TRACKED_READS) {
      inFlightHistory.set(key, request);
      const current = request;
      void request
        .finally(() => {
          if (inFlightHistory.get(key) === current) inFlightHistory.delete(key);
        })
        .catch(() => {});
    }
  }
  const events = await request;
  return signal.aborted ? [] : events;
}

/** Complete canonical read for continuation/export, never a UI preview. */
export function loadCliHistory(
  sessionId: string,
  signal: AbortSignal
): Promise<SessionEvent[]> {
  return loadHistory(sessionId, signal, "full");
}

/** Chat keeps one recent body and lazy placeholders for older native turns. */
export function loadCliPreviewHistory(
  sessionId: string,
  signal: AbortSignal
): Promise<SessionEvent[]> {
  return loadHistory(sessionId, signal, "preview");
}

/**
 * Read the provider file set's opaque revision through the same Rust binding
 * that owns CLI transcript replay. `undefined` means this is a legacy DB
 * transcript; `null` means a native transcript is currently
 * unbound/unavailable and must not be cached as a stable canonical snapshot.
 */
export async function loadCliTranscriptRevision(
  sessionId: string
): Promise<string | null | undefined> {
  const result = await rpc.cli.transcriptRevision({ sessionId });
  if (!result.native) return undefined;
  return result.revision ?? null;
}

export async function postLoadCliSession(
  sessionId: string,
  signal: AbortSignal
): Promise<PostLoadResult> {
  const result: PostLoadResult = {};
  try {
    const storedSession = (await rpc.cli.status({
      sessionId,
    })) as StoredSession | null;
    if (signal.aborted || !storedSession) return result;

    if (storedSession.transcriptSource) {
      result.transcriptSource = storedSession.transcriptSource;
    }

    const status = storedSession.status as CliSessionStatus;
    if (status !== "idle") {
      result.runStatus = status;
      if (
        (status === "failed" || status === "error") &&
        storedSession.errorMessage
      ) {
        result.runError = storedSession.errorMessage;
      }
    }
  } catch (error) {
    log.warn("[CliAdapter] postLoad status fetch failed:", error);
  }
  if (signal.aborted) return {};
  try {
    const usage = await cliSessionContextUsage(sessionId);
    if (signal.aborted) return {};
    result.contextUsage = usage;
    result.contextTokens = usage?.usedTokens ?? 0;
  } catch (error) {
    log.warn("[CliAdapter] context telemetry unavailable:", error);
    result.contextUsage = null;
    result.contextTokens = 0;
  }
  return result;
}
