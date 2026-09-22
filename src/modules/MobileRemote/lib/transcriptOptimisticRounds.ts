import {
  LOCAL_PENDING_ROUND_PREFIX,
  type TranscriptLoadState,
  type TranscriptRoundSummary,
} from "./transcriptLoadStateTypes";
import { pruneLocalPendingRounds } from "./transcriptPendingRounds";
import {
  MAX_MOBILE_TRANSCRIPT_ITEMS,
  type TranscriptItem,
} from "./transcriptReducer";
import {
  createUnloadedRoundBody,
  pruneReadyRoundBodies,
  selectTranscriptRound,
} from "./transcriptRoundBodies";

export function appendOptimisticUserMessage(
  state: TranscriptLoadState,
  sessionId: string,
  turnIntentId: string,
  text: string,
  createdAt = new Date().toISOString()
): TranscriptLoadState {
  if (state.sessionId !== sessionId) return state;
  const pendingRoundId = `${LOCAL_PENDING_ROUND_PREFIX}${turnIntentId}`;
  const hasPendingRound = state.rounds.some(
    (round) => round.id === pendingRoundId
  );
  const stateWithLatest = hasPendingRound
    ? state
    : {
        ...state,
        indexPhase: "ready" as const,
        indexError: undefined,
        rounds: [
          ...state.rounds,
          {
            id: pendingRoundId,
            userPreview: text,
            status: "pending",
          },
        ],
        selectedRoundId: null,
        bodies: {
          ...state.bodies,
          [pendingRoundId]: createUnloadedRoundBody(),
        },
      };
  const selectedLatest = selectTranscriptRound(
    pruneLocalPendingRounds(stateWithLatest),
    null
  );
  const body =
    selectedLatest.bodies[pendingRoundId] ?? createUnloadedRoundBody();
  const id = `mobile-user-${turnIntentId}`;
  if (body.items.some((item) => item.id === id)) return selectedLatest;
  const optimisticItem: TranscriptItem = {
    id,
    kind: "user",
    text,
    createdAt,
    optimistic: true,
    turnIntentId,
  };
  const accessOrdinal = selectedLatest.accessOrdinal + 1;
  return pruneReadyRoundBodies({
    ...selectedLatest,
    accessOrdinal,
    bodies: {
      ...selectedLatest.bodies,
      [pendingRoundId]: {
        ...body,
        phase: "ready",
        items: [...body.items, optimisticItem].slice(
          -MAX_MOBILE_TRANSCRIPT_ITEMS
        ),
        accessOrdinal,
        error: undefined,
      },
    },
  });
}

export function rollbackOptimisticUserMessage(
  state: TranscriptLoadState,
  sessionId: string,
  turnIntentId: string
): TranscriptLoadState {
  if (state.sessionId !== sessionId) return state;
  const id = `mobile-user-${turnIntentId}`;
  const pendingRoundId = `${LOCAL_PENDING_ROUND_PREFIX}${turnIntentId}`;
  const pendingRoundExists = state.rounds.some(
    (round) => round.id === pendingRoundId
  );
  let changed = false;
  const bodies = Object.fromEntries(
    Object.entries(state.bodies).map(([roundId, body]) => {
      const items = body.items.filter((item) => item.id !== id);
      if (items.length !== body.items.length) changed = true;
      return [
        roundId,
        items.length === body.items.length ? body : { ...body, items },
      ];
    })
  );
  if (!changed && !pendingRoundExists) return state;

  const rounds = state.rounds.filter((round) => round.id !== pendingRoundId);
  delete bodies[pendingRoundId];
  return {
    ...state,
    indexPhase: rounds.length > 0 ? state.indexPhase : "empty",
    rounds,
    selectedRoundId:
      state.selectedRoundId === pendingRoundId ? null : state.selectedRoundId,
    bodies,
  };
}

/**
 * Promote one client-created round only after the source adapter proves its
 * authoritative round identity. Positional or text-only matching is
 * intentionally forbidden because desktop and mobile can append concurrently.
 */
export function confirmOptimisticUserRound(
  state: TranscriptLoadState,
  sessionId: string,
  turnIntentId: string,
  roundId: string
): TranscriptLoadState {
  if (state.sessionId !== sessionId || !roundId.trim()) return state;
  const pendingRoundId = `${LOCAL_PENDING_ROUND_PREFIX}${turnIntentId}`;
  const pendingRound = state.rounds.find(
    (round) => round.id === pendingRoundId
  );
  if (!pendingRound) return state;

  const pendingBody = state.bodies[pendingRoundId];
  const authoritativeBody = state.bodies[roundId];
  const mergedItems = [
    ...(authoritativeBody?.items ?? []),
    ...(pendingBody?.items ?? []).filter(
      (item) =>
        !(authoritativeBody?.items ?? []).some(
          (candidate) => candidate.id === item.id
        )
    ),
  ].slice(-MAX_MOBILE_TRANSCRIPT_ITEMS);
  const replacement: TranscriptRoundSummary = {
    ...pendingRound,
    id: roundId,
    turnIntentId,
    status: "completed",
  };
  const rounds = state.rounds.some((round) => round.id === roundId)
    ? state.rounds.filter((round) => round.id !== pendingRoundId)
    : state.rounds.map((round) =>
        round.id === pendingRoundId ? replacement : round
      );
  const bodies = { ...state.bodies };
  delete bodies[pendingRoundId];
  bodies[roundId] = {
    ...(authoritativeBody ?? pendingBody ?? createUnloadedRoundBody()),
    phase: mergedItems.length > 0 ? "ready" : "unloaded",
    items: mergedItems,
    error: undefined,
  };

  return pruneReadyRoundBodies({
    ...state,
    rounds,
    selectedRoundId:
      state.selectedRoundId === pendingRoundId
        ? roundId
        : state.selectedRoundId,
    bodies,
  });
}
