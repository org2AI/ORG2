import {
  type SelectedTranscriptView,
  type TranscriptLoadState,
  type TranscriptRoundResult,
} from "./transcriptLoadStateTypes";
import type { TranscriptItem } from "./transcriptReducer";
import {
  applySnapshotToRoundBody,
  pruneReadyRoundBodies,
  resetSupersededRoundLoads,
  selectedTranscriptRoundId,
} from "./transcriptRoundBodies";

export type {
  SelectedTranscriptView,
  TranscriptLoadPhase,
  TranscriptLoadState,
  TranscriptRoundBodyPhase,
  TranscriptRoundBodyState,
  TranscriptRoundIndexEnvelope,
  TranscriptRoundResult,
  TranscriptRoundSummary,
  TranscriptSnapshotEnvelope,
  TranscriptSubscribeResult,
} from "./transcriptLoadStateTypes";
export {
  LEGACY_LATEST_ROUND_ID,
  LOCAL_PENDING_ROUND_PREFIX,
  MAX_LOCAL_PENDING_ROUNDS,
  MAX_READY_ROUND_BODIES,
} from "./transcriptLoadStateTypes";
export {
  latestTranscriptRoundId,
  selectTranscriptRound,
  selectedTranscriptRoundId,
} from "./transcriptRoundBodies";
export {
  applyLiveTranscriptSnapshot,
  applyTranscriptSubscribeResult,
} from "./transcriptSnapshotIngest";
export {
  appendOptimisticUserMessage,
  confirmOptimisticUserRound,
  rollbackOptimisticUserMessage,
} from "./transcriptOptimisticRounds";

export function createInitialTranscriptLoadState(): TranscriptLoadState {
  return {
    sessionId: null,
    generation: 0,
    indexPhase: "idle",
    rounds: [],
    roundsComplete: false,
    selectedRoundId: null,
    bodies: {},
    accessOrdinal: 0,
  };
}

export function beginTranscriptLoad(
  state: TranscriptLoadState,
  sessionId: string,
  generation: number
): TranscriptLoadState {
  if (state.sessionId !== sessionId) {
    return {
      sessionId,
      generation,
      indexPhase: "loading",
      rounds: [],
      roundsComplete: false,
      selectedRoundId: null,
      bodies: {},
      accessOrdinal: 0,
    };
  }
  return {
    ...state,
    generation,
    indexPhase: "loading",
    indexError: undefined,
    bodies: resetSupersededRoundLoads(
      state.bodies,
      selectedTranscriptRoundId(state)
    ),
  };
}

export function failTranscriptLoad(
  state: TranscriptLoadState,
  sessionId: string,
  generation: number,
  error: string
): TranscriptLoadState {
  if (state.sessionId !== sessionId || state.generation !== generation) {
    return state;
  }
  return { ...state, indexPhase: "error", indexError: error };
}

export function beginTranscriptRoundLoad(
  state: TranscriptLoadState,
  sessionId: string,
  roundId: string,
  requestGeneration: number
): TranscriptLoadState {
  if (
    state.sessionId !== sessionId ||
    selectedTranscriptRoundId(state) !== roundId ||
    !state.bodies[roundId]
  ) {
    return state;
  }
  const body = state.bodies[roundId];
  if (body.phase === "ready") return state;
  return {
    ...state,
    bodies: {
      ...state.bodies,
      [roundId]: {
        ...body,
        phase: "loading",
        requestGeneration,
        error: undefined,
      },
    },
  };
}

export function applyTranscriptRoundResult(
  state: TranscriptLoadState,
  result: TranscriptRoundResult,
  sessionId: string,
  roundId: string,
  sessionGeneration: number,
  requestGeneration: number
): TranscriptLoadState {
  const body = state.bodies[roundId];
  if (
    state.sessionId !== sessionId ||
    state.generation !== sessionGeneration ||
    selectedTranscriptRoundId(state) !== roundId ||
    result.sessionId !== sessionId ||
    result.roundId !== roundId ||
    body?.phase !== "loading" ||
    body.requestGeneration !== requestGeneration
  ) {
    return state;
  }
  const accessOrdinal = state.accessOrdinal + 1;
  const loadedBody = result.snapshot
    ? applySnapshotToRoundBody(body, result.snapshot, accessOrdinal)
    : { ...body, phase: "ready" as const, items: [], accessOrdinal };
  return pruneReadyRoundBodies({
    ...state,
    accessOrdinal,
    bodies: { ...state.bodies, [roundId]: loadedBody },
  });
}

export function failTranscriptRoundLoad(
  state: TranscriptLoadState,
  sessionId: string,
  roundId: string,
  sessionGeneration: number,
  requestGeneration: number,
  error: string
): TranscriptLoadState {
  const body = state.bodies[roundId];
  if (
    state.sessionId !== sessionId ||
    state.generation !== sessionGeneration ||
    selectedTranscriptRoundId(state) !== roundId ||
    body?.phase !== "loading" ||
    body.requestGeneration !== requestGeneration
  ) {
    return state;
  }
  return {
    ...state,
    bodies: {
      ...state.bodies,
      [roundId]: { ...body, phase: "error", error },
    },
  };
}

export function retrySelectedTranscriptRound(
  state: TranscriptLoadState
): TranscriptLoadState {
  const roundId = selectedTranscriptRoundId(state);
  if (!roundId || state.bodies[roundId]?.phase !== "error") return state;
  return {
    ...state,
    bodies: {
      ...state.bodies,
      [roundId]: {
        ...state.bodies[roundId],
        phase: "unloaded",
        error: undefined,
      },
    },
  };
}

export function getSelectedTranscriptView(
  state: TranscriptLoadState
): SelectedTranscriptView {
  const roundId = selectedTranscriptRoundId(state);
  if (!roundId) {
    if (state.indexPhase === "error") {
      return {
        roundId: null,
        items: [],
        phase: "error",
        error: state.indexError,
        truncated: false,
      };
    }
    return {
      roundId: null,
      items: [],
      phase:
        state.indexPhase === "idle" || state.indexPhase === "loading"
          ? state.indexPhase
          : "empty",
      truncated: false,
    };
  }
  const body = state.bodies[roundId];
  if (!body || body.phase === "unloaded" || body.phase === "loading") {
    return {
      roundId,
      items: body?.items ?? [],
      phase: "loading",
      truncated: body?.truncated ?? false,
    };
  }
  if (body.phase === "error") {
    return {
      roundId,
      items: body.items,
      phase: "error",
      error: body.error,
      truncated: body.truncated,
    };
  }
  return {
    roundId,
    items: body.items,
    phase: body.items.length > 0 ? "ready" : "empty",
    truncated: body.truncated,
  };
}

export function readyTranscriptLoadState(
  sessionId: string,
  generation: number,
  items: TranscriptItem[]
): TranscriptLoadState {
  const roundId = "demo-round";
  return {
    sessionId,
    generation,
    indexPhase: "ready",
    rounds: [{ id: roundId, userPreview: items[0]?.text }],
    roundsComplete: true,
    selectedRoundId: null,
    bodies: {
      [roundId]: {
        phase: "ready",
        version: 0,
        items,
        requestGeneration: 0,
        accessOrdinal: 1,
        truncated: false,
        liveDirty: false,
      },
    },
    accessOrdinal: 1,
  };
}
