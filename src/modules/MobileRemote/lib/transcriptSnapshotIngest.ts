import {
  LEGACY_LATEST_ROUND_ID,
  type TranscriptLoadState,
  type TranscriptRoundBodyState,
  type TranscriptSnapshotEnvelope,
  type TranscriptSubscribeResult,
} from "./transcriptLoadStateTypes";
import {
  confirmedPendingRoundMapping,
  isLocalPendingRoundId,
  normalizeRoundSummaries,
  pendingRoundIdFromSnapshot,
  scopeSnapshotToPendingRound,
} from "./transcriptPendingRounds";
import { MAX_MOBILE_TRANSCRIPT_ITEMS } from "./transcriptReducer";
import {
  applySnapshotToRoundBody,
  createUnloadedRoundBody,
  isOptimisticUserItem,
  latestTranscriptRoundId,
  pruneReadyRoundBodies,
} from "./transcriptRoundBodies";

export function applyTranscriptSubscribeResult(
  state: TranscriptLoadState,
  result: TranscriptSubscribeResult,
  sessionId: string,
  generation: number
): TranscriptLoadState {
  if (state.sessionId !== sessionId || state.generation !== generation) {
    return state;
  }
  if (result.sessionId && result.sessionId !== sessionId) return state;

  const hasRoundIndex = Array.isArray(result.rounds?.items);
  const hasSnapshotEvents = Boolean(
    result.snapshot &&
    ((Array.isArray(result.snapshot.events) &&
      result.snapshot.events.length > 0) ||
      (Array.isArray(result.snapshot.upserts) &&
        result.snapshot.upserts.length > 0))
  );
  const authoritativeRounds = hasRoundIndex
    ? normalizeRoundSummaries(result.rounds?.items)
    : state.rounds.some((round) => !isLocalPendingRoundId(round.id))
      ? state.rounds.filter((round) => !isLocalPendingRoundId(round.id))
      : hasSnapshotEvents
        ? [
            {
              id: result.snapshot?.roundId ?? LEGACY_LATEST_ROUND_ID,
              userPreview: "",
            },
          ]
        : [];
  // A pending round is a user interaction boundary, not merely an
  // optimistic row. A live authoritative user echo can replace that row
  // before the provider's round directory advances, so keep the boundary
  // until an exact turnIntentId/roundId mapping confirms its owner.
  const pendingRounds = state.rounds.filter((round) =>
    isLocalPendingRoundId(round.id)
  );
  const snapshotPendingRoundId = pendingRoundIdFromSnapshot(
    pendingRounds,
    result.snapshot
  );
  const previousAuthoritativeLatestId = state.rounds
    .filter((round) => !isLocalPendingRoundId(round.id))
    .at(-1)?.id;
  const previousAuthoritativeIndex = previousAuthoritativeLatestId
    ? authoritativeRounds.findIndex(
        (round) => round.id === previousAuthoritativeLatestId
      )
    : -1;
  const newlyIndexedRounds = previousAuthoritativeLatestId
    ? previousAuthoritativeIndex >= 0
      ? authoritativeRounds.slice(previousAuthoritativeIndex + 1)
      : []
    : authoritativeRounds.slice(-pendingRounds.length);
  const confirmedPendingRoundIds = confirmedPendingRoundMapping(
    pendingRounds,
    newlyIndexedRounds,
    result.snapshot
  );
  const unconfirmedPendingRounds = pendingRounds.filter(
    (round) => !confirmedPendingRoundIds.has(round.id)
  );
  const rounds = [...authoritativeRounds, ...unconfirmedPendingRounds];
  const roundIds = new Set(rounds.map((round) => round.id));
  const authoritativeLatestId = authoritativeRounds.at(-1)?.id ?? null;
  const latestRoundChanged =
    previousAuthoritativeLatestId != null &&
    authoritativeLatestId != null &&
    previousAuthoritativeLatestId !== authoritativeLatestId;
  const legacyOptimisticItems = previousAuthoritativeLatestId
    ? (state.bodies[previousAuthoritativeLatestId]?.items ?? []).filter(
        isOptimisticUserItem
      )
    : [];
  const bodies: Record<string, TranscriptRoundBodyState> = {};
  for (const round of authoritativeRounds) {
    const previous = state.bodies[round.id];
    if (!previous) {
      bodies[round.id] = createUnloadedRoundBody();
    } else if (
      latestRoundChanged &&
      round.id === previousAuthoritativeLatestId &&
      previous.liveDirty
    ) {
      // Until the index advances, notifications for a newly-created round are
      // necessarily projected into the previous latest body. Do not preserve
      // those ambiguous rows as history once ownership becomes knowable;
      // selecting this round will reload its exact body via session/round.
      bodies[round.id] = createUnloadedRoundBody();
    } else if (previous.phase === "loading") {
      bodies[round.id] = {
        ...createUnloadedRoundBody(),
        version: previous.version,
        items:
          round.id === authoritativeLatestId
            ? previous.items
            : previous.items.filter((item) => !isOptimisticUserItem(item)),
        truncated: previous.truncated,
      };
    } else {
      bodies[round.id] =
        round.id === authoritativeLatestId
          ? previous
          : {
              ...previous,
              items: previous.items.filter(
                (item) => !isOptimisticUserItem(item)
              ),
            };
    }
  }

  for (const pendingRound of unconfirmedPendingRounds) {
    bodies[pendingRound.id] =
      state.bodies[pendingRound.id] ?? createUnloadedRoundBody();
  }

  for (const [
    pendingRoundId,
    authoritativeRoundId,
  ] of confirmedPendingRoundIds) {
    const pendingBody = state.bodies[pendingRoundId];
    if (!pendingBody) continue;
    const authoritativeBody =
      bodies[authoritativeRoundId] ?? createUnloadedRoundBody();
    const pendingItems = pendingBody.items.filter(
      (item) =>
        !authoritativeBody.items.some((candidate) => candidate.id === item.id)
    );
    bodies[authoritativeRoundId] = {
      ...authoritativeBody,
      phase: "ready",
      items: [...authoritativeBody.items, ...pendingItems].slice(
        -MAX_MOBILE_TRANSCRIPT_ITEMS
      ),
      truncated: authoritativeBody.truncated || pendingBody.truncated,
      liveDirty: false,
      error: undefined,
    };
  }

  let accessOrdinal = state.accessOrdinal;
  if (authoritativeLatestId) {
    const latestBody =
      bodies[authoritativeLatestId] ?? createUnloadedRoundBody();
    const migratedOptimisticItems = [
      ...latestBody.items,
      ...legacyOptimisticItems.filter(
        (item) =>
          !latestBody.items.some((candidate) => candidate.id === item.id)
      ),
    ];
    accessOrdinal += 1;
    bodies[authoritativeLatestId] = {
      ...latestBody,
      phase: "ready",
      items: migratedOptimisticItems,
      accessOrdinal,
      error: undefined,
    };
    const mappedSnapshotPendingRoundId = snapshotPendingRoundId
      ? (confirmedPendingRoundIds.get(snapshotPendingRoundId) ??
        snapshotPendingRoundId)
      : null;
    const snapshotRoundId =
      mappedSnapshotPendingRoundId && roundIds.has(mappedSnapshotPendingRoundId)
        ? mappedSnapshotPendingRoundId
        : result.snapshot?.roundId && roundIds.has(result.snapshot.roundId)
          ? result.snapshot.roundId
          : authoritativeLatestId;
    const snapshotBody = bodies[snapshotRoundId] ?? createUnloadedRoundBody();
    if (result.snapshot) {
      bodies[snapshotRoundId] = applySnapshotToRoundBody(
        snapshotBody,
        snapshotPendingRoundId
          ? scopeSnapshotToPendingRound(result.snapshot, snapshotPendingRoundId)
          : result.snapshot,
        accessOrdinal
      );
    }
  }

  const mappedSelectedRoundId = state.selectedRoundId
    ? (confirmedPendingRoundIds.get(state.selectedRoundId) ??
      state.selectedRoundId)
    : null;
  const selectedRoundId =
    mappedSelectedRoundId && roundIds.has(mappedSelectedRoundId)
      ? mappedSelectedRoundId
      : null;
  return pruneReadyRoundBodies({
    ...state,
    indexPhase: rounds.length > 0 ? "ready" : "empty",
    indexError: undefined,
    rounds,
    roundsComplete: hasRoundIndex ? result.rounds?.complete === true : false,
    selectedRoundId,
    bodies,
    accessOrdinal,
  });
}

export function applyLiveTranscriptSnapshot(
  state: TranscriptLoadState,
  envelope: TranscriptSnapshotEnvelope
): TranscriptLoadState {
  if (envelope.sessionId !== state.sessionId) return state;
  const pendingRounds = state.rounds.filter((round) =>
    isLocalPendingRoundId(round.id)
  );
  const matchedPendingRoundId = pendingRoundIdFromSnapshot(
    pendingRounds,
    envelope
  );
  const latestId = latestTranscriptRoundId(state);
  const envelopeRoundId = envelope.roundId?.trim();
  const targetRoundId =
    matchedPendingRoundId ??
    (envelopeRoundId &&
    state.rounds.some((round) => round.id === envelopeRoundId)
      ? envelopeRoundId
      : latestId);
  if (!targetRoundId) return state;

  // A full baseline without the provisional turn's opening user identity is
  // not safe to project into that provisional round: it may be the previous
  // loaded round emitted just before the new user event was appended.
  if (
    isLocalPendingRoundId(targetRoundId) &&
    envelope.snapshotDelta !== true &&
    matchedPendingRoundId == null
  ) {
    return state;
  }

  const scopedEnvelope = matchedPendingRoundId
    ? scopeSnapshotToPendingRound(envelope, matchedPendingRoundId)
    : envelope;
  const body = state.bodies[targetRoundId] ?? createUnloadedRoundBody();
  const accessOrdinal = state.accessOrdinal + 1;
  return pruneReadyRoundBodies({
    ...state,
    accessOrdinal,
    bodies: {
      ...state.bodies,
      [targetRoundId]: applySnapshotToRoundBody(
        body,
        scopedEnvelope,
        accessOrdinal,
        true
      ),
    },
  });
}
