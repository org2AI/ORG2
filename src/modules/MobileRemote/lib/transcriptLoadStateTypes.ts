import type { SnapshotUpsertEvent, TranscriptItem } from "./transcriptReducer";

export type TranscriptLoadPhase =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export type TranscriptRoundBodyPhase =
  | "unloaded"
  | "loading"
  | "ready"
  | "error";

export interface TranscriptRoundSummary {
  id: string;
  /** Canonical identity of the user submission that opened this round. */
  turnIntentId?: string | null;
  nextRoundId?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  durationMs?: number | null;
  userPreview?: string;
  eventCount?: number;
  bodyEventCount?: number;
  status?: string;
}

export interface TranscriptRoundIndexEnvelope {
  items: TranscriptRoundSummary[];
  complete: boolean;
}

export interface TranscriptSnapshotEnvelope {
  sessionId?: string;
  roundId?: string;
  version?: number;
  snapshotDelta?: boolean;
  streaming?: boolean;
  truncated?: boolean;
  events?: SnapshotUpsertEvent[];
  upserts?: SnapshotUpsertEvent[];
  removedIds?: string[];
}

export interface TranscriptSubscribeResult {
  sessionId?: string;
  rounds?: TranscriptRoundIndexEnvelope;
  snapshot?: TranscriptSnapshotEnvelope;
  /** Latest body is ready; the full directory is available through session/history. */
  historyDeferred?: boolean;
}

export interface TranscriptRoundResult {
  sessionId?: string;
  roundId?: string;
  snapshot?: TranscriptSnapshotEnvelope;
}

export interface TranscriptRoundBodyState {
  phase: TranscriptRoundBodyPhase;
  version: number;
  items: TranscriptItem[];
  requestGeneration: number;
  accessOrdinal: number;
  truncated: boolean;
  /** Live rows received before the round index confirms their ownership. */
  liveDirty: boolean;
  error?: string;
}

export interface TranscriptLoadState {
  sessionId: string | null;
  /** Guards the active session subscription/index refresh. */
  generation: number;
  indexPhase: TranscriptLoadPhase;
  indexError?: string;
  rounds: TranscriptRoundSummary[];
  roundsComplete: boolean;
  /** Null deliberately means "follow whichever round is latest". */
  selectedRoundId: string | null;
  bodies: Record<string, TranscriptRoundBodyState>;
  accessOrdinal: number;
}

export interface SelectedTranscriptView {
  roundId: string | null;
  items: TranscriptItem[];
  phase: TranscriptLoadPhase;
  error?: string;
  truncated: boolean;
}

export const MAX_READY_ROUND_BODIES = 8;
export const MAX_LOCAL_PENDING_ROUNDS = 8;
export const LEGACY_LATEST_ROUND_ID = "legacy-latest";
export const LOCAL_PENDING_ROUND_PREFIX = "local-pending:";
