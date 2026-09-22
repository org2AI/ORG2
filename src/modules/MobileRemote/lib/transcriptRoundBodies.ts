import {
  MAX_READY_ROUND_BODIES,
  type TranscriptLoadState,
  type TranscriptRoundBodyState,
  type TranscriptSnapshotEnvelope,
} from "./transcriptLoadStateTypes";
import {
  MAX_MOBILE_TRANSCRIPT_ITEMS,
  type SnapshotUpsertEvent,
  type TranscriptItem,
  reduceTranscriptFromUpserts,
} from "./transcriptReducer";

export function createUnloadedRoundBody(): TranscriptRoundBodyState {
  return {
    phase: "unloaded",
    version: 0,
    items: [],
    requestGeneration: 0,
    accessOrdinal: 0,
    truncated: false,
    liveDirty: false,
  };
}

export function isOptimisticUserItem(item: TranscriptItem): boolean {
  return item.kind === "user" && item.optimistic === true;
}

export function snapshotUpserts(
  envelope: TranscriptSnapshotEnvelope
): SnapshotUpsertEvent[] {
  if (envelope.snapshotDelta === true) {
    return Array.isArray(envelope.upserts) ? envelope.upserts : [];
  }
  if (Array.isArray(envelope.events)) return envelope.events;
  return Array.isArray(envelope.upserts) ? envelope.upserts : [];
}

function reconcileOptimisticUserItems(
  previousItems: TranscriptItem[],
  projectedItems: TranscriptItem[]
): TranscriptItem[] {
  const optimisticItems = previousItems.filter(isOptimisticUserItem);
  if (optimisticItems.length === 0) return projectedItems;

  const knownAuthoritativeIds = new Set(
    previousItems
      .filter((item) => !isOptimisticUserItem(item))
      .map((item) => item.id)
  );
  const newAuthoritativeUsers = projectedItems.filter(
    (item) =>
      item.kind === "user" &&
      !isOptimisticUserItem(item) &&
      !knownAuthoritativeIds.has(item.id)
  );
  const consumedAuthoritativeIds = new Set<string>();
  const unmatchedOptimisticItems = optimisticItems.filter((optimistic) => {
    const exactIntentEcho = optimistic.turnIntentId
      ? newAuthoritativeUsers.find(
          (candidate) =>
            !consumedAuthoritativeIds.has(candidate.id) &&
            candidate.turnIntentId === optimistic.turnIntentId
        )
      : undefined;
    const echo = exactIntentEcho;
    if (!echo) return true;
    consumedAuthoritativeIds.add(echo.id);
    return false;
  });

  const authoritativeItems = projectedItems.filter(
    (item) => !isOptimisticUserItem(item)
  );
  // A response can race ahead of the durable user-message echo, and the phone
  // clock can disagree with the desktop by minutes. Reinsert each unmatched
  // optimistic question directly after the authoritative row that was the
  // tail when the user submitted it. This remains stable across later full
  // snapshots where the raced assistant row has become "known" history.
  const merged = [...authoritativeItems];
  for (const optimistic of unmatchedOptimisticItems) {
    const anchorIndex = optimistic.localAnchorId
      ? merged.findIndex((item) => item.id === optimistic.localAnchorId)
      : -1;
    let insertionIndex = anchorIndex >= 0 ? anchorIndex + 1 : 0;
    while (
      insertionIndex < merged.length &&
      isOptimisticUserItem(merged[insertionIndex]) &&
      merged[insertionIndex].localAnchorId === optimistic.localAnchorId
    ) {
      insertionIndex += 1;
    }
    merged.splice(insertionIndex, 0, optimistic);
  }
  return merged.slice(-MAX_MOBILE_TRANSCRIPT_ITEMS);
}

export function latestTranscriptRoundId(
  state: Pick<TranscriptLoadState, "rounds">
): string | null {
  return state.rounds.at(-1)?.id ?? null;
}

export function selectedTranscriptRoundId(
  state: Pick<TranscriptLoadState, "rounds" | "selectedRoundId">
): string | null {
  return state.selectedRoundId ?? latestTranscriptRoundId(state);
}

export function applySnapshotToRoundBody(
  body: TranscriptRoundBodyState,
  envelope: TranscriptSnapshotEnvelope,
  accessOrdinal: number,
  markLiveDirty = false
): TranscriptRoundBodyState {
  const isDelta = envelope.snapshotDelta === true;
  const incomingVersion =
    typeof envelope.version === "number" ? envelope.version : body.version;
  if (isDelta && incomingVersion < body.version) return body;

  const upserts = snapshotUpserts(envelope);
  const removedIds = Array.isArray(envelope.removedIds)
    ? envelope.removedIds.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  // Full snapshots are authoritative baselines. Their version can come from
  // a different lineage (exact round loads currently start at 0) than the
  // live EventStore delta stream, so a numeric comparison must not turn a
  // baseline into an append and preserve rows from the previous round.
  const replace = !isDelta;
  const projected = reduceTranscriptFromUpserts(
    { items: body.items },
    upserts,
    { removedIds, replace }
  );
  return {
    phase: "ready",
    version: isDelta
      ? Math.max(body.version, incomingVersion)
      : incomingVersion,
    items: reconcileOptimisticUserItems(body.items, projected.items),
    requestGeneration: body.requestGeneration,
    accessOrdinal,
    truncated: isDelta
      ? body.truncated || envelope.truncated === true
      : envelope.truncated === true,
    liveDirty: markLiveDirty || (isDelta && body.liveDirty),
  };
}

export function pruneReadyRoundBodies(
  state: TranscriptLoadState
): TranscriptLoadState {
  const readyIds = Object.entries(state.bodies)
    .filter(([, body]) => body.phase === "ready")
    .map(([roundId]) => roundId);
  if (readyIds.length <= MAX_READY_ROUND_BODIES) return state;

  const selectedId = selectedTranscriptRoundId(state);
  const latestId = latestTranscriptRoundId(state);
  const removable = readyIds
    .filter((roundId) => roundId !== selectedId && roundId !== latestId)
    .sort(
      (left, right) =>
        state.bodies[left].accessOrdinal - state.bodies[right].accessOrdinal
    );
  const bodies = { ...state.bodies };
  let readyCount = readyIds.length;
  for (const roundId of removable) {
    if (readyCount <= MAX_READY_ROUND_BODIES) break;
    bodies[roundId] = createUnloadedRoundBody();
    readyCount -= 1;
  }
  return { ...state, bodies };
}

function touchReadyRound(
  state: TranscriptLoadState,
  roundId: string
): TranscriptLoadState {
  const body = state.bodies[roundId];
  if (body?.phase !== "ready") return state;
  const accessOrdinal = state.accessOrdinal + 1;
  return pruneReadyRoundBodies({
    ...state,
    accessOrdinal,
    bodies: {
      ...state.bodies,
      [roundId]: { ...body, accessOrdinal },
    },
  });
}

export function resetSupersededRoundLoads(
  bodies: Record<string, TranscriptRoundBodyState>,
  selectedRoundId: string | null
): Record<string, TranscriptRoundBodyState> {
  let changed = false;
  const nextBodies = { ...bodies };
  for (const [roundId, body] of Object.entries(bodies)) {
    if (body.phase === "loading" && roundId !== selectedRoundId) {
      nextBodies[roundId] = createUnloadedRoundBody();
      changed = true;
    }
  }
  return changed ? nextBodies : bodies;
}

export function selectTranscriptRound(
  state: TranscriptLoadState,
  roundId: string | null
): TranscriptLoadState {
  const normalizedRoundId =
    roundId && state.rounds.some((round) => round.id === roundId)
      ? roundId
      : null;
  const effectiveRoundId = normalizedRoundId ?? latestTranscriptRoundId(state);
  let next: TranscriptLoadState = {
    ...state,
    selectedRoundId: normalizedRoundId,
    bodies: resetSupersededRoundLoads(state.bodies, effectiveRoundId),
  };
  if (effectiveRoundId) next = touchReadyRound(next, effectiveRoundId);
  return next;
}
