import {
  LOCAL_PENDING_ROUND_PREFIX,
  MAX_LOCAL_PENDING_ROUNDS,
  type TranscriptLoadState,
  type TranscriptRoundSummary,
  type TranscriptSnapshotEnvelope,
} from "./transcriptLoadStateTypes";
import {
  type SnapshotUpsertEvent,
  reduceTranscriptFromUpserts,
} from "./transcriptReducer";
import { snapshotUpserts } from "./transcriptRoundBodies";

export function isLocalPendingRoundId(roundId: string): boolean {
  return roundId.startsWith(LOCAL_PENDING_ROUND_PREFIX);
}

export function pruneLocalPendingRounds(
  state: TranscriptLoadState
): TranscriptLoadState {
  const pendingIds = state.rounds
    .map((round) => round.id)
    .filter(isLocalPendingRoundId);
  if (pendingIds.length <= MAX_LOCAL_PENDING_ROUNDS) return state;
  const removedIds = new Set(
    pendingIds.slice(0, pendingIds.length - MAX_LOCAL_PENDING_ROUNDS)
  );
  const bodies = { ...state.bodies };
  for (const roundId of removedIds) delete bodies[roundId];
  return {
    ...state,
    rounds: state.rounds.filter((round) => !removedIds.has(round.id)),
    selectedRoundId:
      state.selectedRoundId && removedIds.has(state.selectedRoundId)
        ? null
        : state.selectedRoundId,
    bodies,
  };
}

function isSnapshotUserEvent(event: SnapshotUpsertEvent): boolean {
  const source = event.source?.toLowerCase();
  const canonical = (
    event.uiCanonical ??
    event.functionName ??
    ""
  ).toLowerCase();
  return (
    source === "user" || canonical === "user" || canonical === "user_message"
  );
}

/**
 * Resolve a full/live snapshot to a provisional round only from the canonical
 * submit identity echoed by its opening user event. A full EventStore
 * baseline can still contain the previous loaded round, so "latest pending"
 * alone is not proof of ownership.
 */
export function pendingRoundIdFromSnapshot(
  pendingRounds: TranscriptRoundSummary[],
  envelope: TranscriptSnapshotEnvelope | undefined
): string | null {
  if (!envelope || pendingRounds.length === 0) return null;
  const pendingIds = new Set(pendingRounds.map((round) => round.id));
  for (const event of [...snapshotUpserts(envelope)].reverse()) {
    if (!isSnapshotUserEvent(event) || !event.turnIntentId) continue;
    const pendingRoundId = `${LOCAL_PENDING_ROUND_PREFIX}${event.turnIntentId}`;
    if (pendingIds.has(pendingRoundId)) return pendingRoundId;
  }
  return null;
}

/**
 * A full EventStore baseline is session-window scoped, not round scoped. When
 * its user identity proves that it belongs to a provisional round, discard
 * the older loaded-round prefix before projecting it into that round.
 */
export function scopeSnapshotToPendingRound(
  envelope: TranscriptSnapshotEnvelope,
  pendingRoundId: string
): TranscriptSnapshotEnvelope {
  const turnIntentId = pendingRoundId.slice(LOCAL_PENDING_ROUND_PREFIX.length);
  const events = snapshotUpserts(envelope);
  let start = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isSnapshotUserEvent(event) && event.turnIntentId === turnIntentId) {
      start = index;
      break;
    }
  }
  if (start < 0) return envelope;
  let end = events.length;
  for (let index = start + 1; index < events.length; index += 1) {
    if (isSnapshotUserEvent(events[index])) {
      end = index;
      break;
    }
  }
  const scopedEvents = events.slice(start, end);
  if (envelope.snapshotDelta === true) {
    return { ...envelope, upserts: scopedEvents };
  }
  if (Array.isArray(envelope.events)) {
    return { ...envelope, events: scopedEvents };
  }
  return { ...envelope, upserts: scopedEvents };
}

export function confirmedPendingRoundMapping(
  pendingRounds: TranscriptRoundSummary[],
  newlyIndexedRounds: TranscriptRoundSummary[],
  snapshot: TranscriptSnapshotEnvelope | undefined
): Map<string, string> {
  const pendingByIntentId = new Map(
    pendingRounds.map((round) => [
      round.id.slice(LOCAL_PENDING_ROUND_PREFIX.length),
      round,
    ])
  );
  const confirmed = new Map<string, string>();
  for (const indexedRound of newlyIndexedRounds) {
    if (!indexedRound.turnIntentId) continue;
    const pendingRound = pendingByIntentId.get(indexedRound.turnIntentId);
    if (pendingRound) confirmed.set(pendingRound.id, indexedRound.id);
  }

  // Backward-compatible confirmation for a desktop that has not yet added
  // turnIntentId to its round directory. The full latest-round snapshot still
  // carries the canonical user-event identity.
  if (!snapshot?.roundId) return confirmed;
  const indexedRound = newlyIndexedRounds.find(
    (round) => round.id === snapshot.roundId
  );
  if (!indexedRound) return confirmed;

  const snapshotUsers = reduceTranscriptFromUpserts(
    { items: [] },
    snapshotUpserts(snapshot),
    { replace: true }
  ).items.filter((item) => item.kind === "user");
  const identifiedUser = snapshotUsers.find((item) => item.turnIntentId);
  if (identifiedUser?.turnIntentId) {
    const pendingRound = pendingByIntentId.get(identifiedUser.turnIntentId);
    if (pendingRound) confirmed.set(pendingRound.id, indexedRound.id);
  }
  return confirmed;
}

export function normalizeRoundSummaries(
  rounds: TranscriptRoundSummary[] | undefined
): TranscriptRoundSummary[] {
  if (!Array.isArray(rounds)) return [];
  const seen = new Set<string>();
  return rounds.filter((round) => {
    if (
      !round ||
      typeof round.id !== "string" ||
      !round.id ||
      seen.has(round.id)
    ) {
      return false;
    }
    seen.add(round.id);
    return true;
  });
}
