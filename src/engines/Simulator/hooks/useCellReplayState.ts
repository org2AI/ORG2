/**
 * useCellReplayState — explicit-mode replay engine for a single grid cell.
 *
 * Owns ALL cursor state for one cell as an explicit FSM with three modes:
 *
 *   ┌─────────┐  user interaction        ┌──────────┐
 *   │ follow  │ ───────────────────────▶ │ detached │
 *   └─────────┘                          └──────────┘
 *      ▲                                     │
 *      │   syncToMain() with no              │ syncToMain()
 *      │   external cursor                   │
 *      │                                     ▼
 *   ┌─────────┐  user interaction       ┌──────────┐
 *   │ synced  │ ─────────────────────── │  (same)  │
 *   └─────────┘                          └──────────┘
 *
 *  - `follow`   — live tail: new events always move the cursor to the end.
 *  - `synced`   — cursor is slaved to `externalCursorMs` via timestamp lookup.
 *  - `detached` — the user owns the cursor. Event growth and external cursor
 *                 movement NEVER touch it. This is the only mode in which the
 *                 user-set position is durable.
 *
 * Scrub sessions
 * --------------
 * `beginScrub` opens a transient scrub session. While open, the cursor follows
 * `scrub(index)` calls instantly without committing to persistence, and BOTH
 * external writes (event growth, external cursor) are gated off. `endScrub`
 * commits the final index once through the persisted setter and transitions
 * to `detached` mode. This replaces the old `IndependentGridCell` 16 ms
 * `setTimeout` debounce + duplicated `isDraggingSlider` state.
 *
 * User controls commit cursor and playback together; timer ticks likewise
 * publish one complete replay transition to persistence.
 */
import { useAtomValue } from "jotai";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { simulatorPlaybackSpeedAtom } from "@src/store/ui/simulatorAtom";

import { findIndexAtTime } from "../utils/findIndexAtTime";
import type {
  CellReplayControls,
  CellReplayState,
  ReplayMode,
  UseCellReplayStateOptions,
  UseCellReplayStateReturn,
} from "./cellReplayTypes";
import { useCellPersistence } from "./useCellPersistence";
import { useCellPlayback } from "./useCellPlayback";

// Re-export types for existing consumers
export type { ReplayMode, UseCellReplayStateOptions, UseCellReplayStateReturn };

function clampIndex(index: number, eventCount: number): number {
  if (eventCount <= 0) return -1;
  if (index < 0) return 0;
  if (index > eventCount - 1) return eventCount - 1;
  return index;
}

export function useCellReplayState(
  options: UseCellReplayStateOptions
): UseCellReplayStateReturn {
  const {
    events,
    autoPlayInterval = 1500,
    startAtEnd = true,
    cellId = "unknown",
    externalCursorMs = null,
  } = options;

  // ── Persistence ──────────────────────────────────────────────────────
  const { persistedState, hasUserOverride, patchCellState, isRemoved } =
    useCellPersistence(cellId);

  // `hasUserOverride` is the persisted "user has detached this cell" flag.
  // Treat it as the durable representation of `detached` mode.
  const isDetached = hasUserOverride;

  // ── Local cursor state ───────────────────────────────────────────────
  const [currentIndex, setCurrentIndexValue] = useState(() => {
    if (persistedState?.currentIndex !== undefined) {
      return Math.min(
        persistedState.currentIndex,
        Math.max(0, events.length - 1)
      );
    }
    return startAtEnd && events.length > 0 ? events.length - 1 : 0;
  });
  // Resolve updates at the event boundary, never inside a React state updater:
  // those updaters can be replayed while rendering (including StrictMode).
  const currentIndexRef = useRef(currentIndex);
  const setCurrentIndexLocal = useCallback((update: SetStateAction<number>) => {
    const next =
      typeof update === "function" ? update(currentIndexRef.current) : update;
    currentIndexRef.current = next;
    setCurrentIndexValue(next);
  }, []);
  const [isPlaying, setIsPlayingLocal] = useState(
    () => persistedState?.isPlaying ?? false
  );
  const [localPlaybackSpeed, setLocalPlaybackSpeed] = useState(1);

  // ── Scrub session ─────────────────────────────────────────────────────
  // During a scrub session the user owns the displayed cursor outright.
  // `scrubIndex` is the live (uncommitted) value shown in the UI.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const isScrubbing = scrubIndex !== null;
  const isScrubbingRef = useRef(isScrubbing);
  useLayoutEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  // Read global speed before passing to playback hook
  const globalPlaybackSpeed = useAtomValue(simulatorPlaybackSpeedAtom);
  const playbackSpeed =
    localPlaybackSpeed !== 1 ? localPlaybackSpeed : globalPlaybackSpeed;

  // ── Mode derivation ───────────────────────────────────────────────────
  // Mode is derived (not stored) — `detached` is persisted as
  // `hasUserOverride`; `synced` vs `follow` is decided by whether the
  // parent supplies an external cursor.
  const mode: ReplayMode = useMemo(() => {
    if (isDetached) return "detached";
    if (externalCursorMs != null) return "synced";
    return "follow";
  }, [isDetached, externalCursorMs]);

  // ── Single cursor-write chokepoint ────────────────────────────────────
  // Every persisted cursor change goes through here. Optional `detach: true`
  // transitions the mode to `detached` in the same patch.
  const commitIndex = useCallback(
    (
      updater: number | ((prev: number) => number),
      opts: { detach?: boolean; isPlayingOverride?: boolean } = {}
    ) => {
      if (opts.isPlayingOverride !== undefined) {
        setIsPlayingLocal(opts.isPlayingOverride);
      }
      setCurrentIndexLocal((prev) => {
        const raw = typeof updater === "function" ? updater(prev) : updater;
        const newValue = clampIndex(raw, events.length);
        patchCellState({
          currentIndex: newValue,
          isPlaying: opts.isPlayingOverride ?? isPlaying,
          ...(opts.detach ? { hasUserOverride: true } : {}),
        });
        return newValue;
      });
    },
    [patchCellState, isPlaying, events.length, setCurrentIndexLocal]
  );

  const commitPlaying = useCallback(
    (value: boolean, opts: { detach?: boolean } = {}) => {
      setIsPlayingLocal(value);
      patchCellState({
        isPlaying: value,
        ...(opts.detach ? { hasUserOverride: true } : {}),
      });
    },
    [patchCellState]
  );

  // ── Playback timer ───────────────────────────────────────────────────
  useCellPlayback({
    enabled: !isRemoved,
    events,
    autoPlayInterval,
    isPlaying,
    isSyncMode: mode === "synced",
    playbackSpeed,
    setCurrentIndexLocal,
    setIsPlayingLocal,
    patchCellState,
  });

  // ── Follow-mode tailing ───────────────────────────────────────────────
  // The ONLY place new events advance the cursor. Gated by mode AND scrub
  // AND playback so a scrub release on a live subagent doesn't teleport
  // the handle back to the right edge.
  const prevEventsLengthRef = useRef(events.length);
  useEffect(() => {
    const prevLen = prevEventsLengthRef.current;
    prevEventsLengthRef.current = events.length;

    if (events.length === prevLen) return;
    if (events.length === 0) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setCurrentIndexLocal(0);
        setIsPlayingLocal(false);
        patchCellState({ currentIndex: 0, isPlaying: false });
      });
      return () => {
        cancelled = true;
      };
    }
    if (isScrubbingRef.current) return;
    if (mode !== "follow") return;
    if (isPlaying) return; // playback timer owns the cursor while playing

    const newLen = events.length;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      // Use the persisted chokepoint so live + persisted stay in lockstep.
      // `markOverride` deliberately false — follow-mode tail is not a user
      // detach action.
      setCurrentIndexLocal(newLen - 1);
      patchCellState({ currentIndex: newLen - 1, isPlaying });
    });
    return () => {
      cancelled = true;
    };
  }, [events.length, isPlaying, mode, patchCellState, setCurrentIndexLocal]);

  // ── Follow-mode entry snap ────────────────────────────────────────────
  // When the cell TRANSITIONS into follow mode (e.g. the main session
  // switches to live "Following Agent" and the parent stops supplying an
  // external cursor), snap to the tail immediately. The tailing effect
  // above only fires on event growth, so without this the cursor would
  // stay wherever synced-mode mapping left it until the next event lands.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;

    if (mode !== "follow" || prevMode === "follow") return;
    if (events.length === 0) return;
    if (isScrubbingRef.current) return;
    if (isPlaying) return;

    const tail = events.length - 1;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCurrentIndexLocal(tail);
      patchCellState({ currentIndex: tail, isPlaying });
    });
    return () => {
      cancelled = true;
    };
  }, [mode, events.length, isPlaying, patchCellState, setCurrentIndexLocal]);

  // ── Synced-mode external-cursor mapping ──────────────────────────────
  const safeIndex = useMemo(() => {
    if (events.length === 0) return -1;
    if (isScrubbing && scrubIndex !== null) {
      return clampIndex(scrubIndex, events.length);
    }
    if (mode === "synced" && externalCursorMs != null) {
      const idx = findIndexAtTime(events, externalCursorMs, {
        preStart: "clamp",
      });
      return Math.max(0, idx);
    }
    return clampIndex(currentIndex, events.length);
  }, [currentIndex, events, externalCursorMs, mode, isScrubbing, scrubIndex]);

  const currentEvent = useMemo(() => {
    if (safeIndex < 0 || safeIndex >= events.length) return null;
    return events[safeIndex];
  }, [events, safeIndex]);

  const progress = useMemo(() => {
    if (events.length <= 1) return 100;
    return (safeIndex / (events.length - 1)) * 100;
  }, [safeIndex, events.length]);

  // ── Controls ─────────────────────────────────────────────────────────
  const play = useCallback(() => {
    if (events.length === 0) return;
    const startFrom =
      mode === "synced"
        ? safeIndex
        : currentIndex >= events.length - 1
          ? 0
          : currentIndex;
    commitIndex(startFrom, { detach: true, isPlayingOverride: true });
  }, [mode, safeIndex, currentIndex, events.length, commitIndex]);

  const pause = useCallback(() => {
    commitPlaying(false);
  }, [commitPlaying]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const next = useCallback(() => {
    const base = mode === "synced" ? safeIndex : currentIndex;
    commitIndex(Math.min(base + 1, events.length - 1), { detach: true });
  }, [mode, safeIndex, currentIndex, events.length, commitIndex]);

  const prev = useCallback(() => {
    const base = mode === "synced" ? safeIndex : currentIndex;
    commitIndex(Math.max(base - 1, 0), { detach: true });
  }, [mode, safeIndex, currentIndex, commitIndex]);

  const goToIndex = useCallback(
    (index: number) => {
      commitIndex(index, { detach: true });
    },
    [commitIndex]
  );

  const goToProgress = useCallback(
    (progressValue: number) => {
      if (events.length <= 1) return;
      const index = Math.round((progressValue / 100) * (events.length - 1));
      commitIndex(index, { detach: true });
    },
    [events.length, commitIndex]
  );

  const setSpeed = useCallback((speed: number) => {
    setLocalPlaybackSpeed(speed);
  }, []);

  const reset = useCallback(() => {
    commitIndex(0, { detach: true, isPlayingOverride: false });
  }, [commitIndex]);

  const goToEnd = useCallback(() => {
    commitIndex(events.length - 1, { detach: true, isPlayingOverride: false });
  }, [events.length, commitIndex]);

  const syncToMain = useCallback(() => {
    setIsPlayingLocal(false);
    setScrubIndex(null);
    patchCellState({ isPlaying: false, hasUserOverride: false });
  }, [patchCellState]);

  // Scrub session API. The bar calls `beginScrub` on pointer-down, `scrub`
  // on each move, and `endScrub` on pointer-up. The cursor is only persisted
  // at `endScrub` time, so transient drag positions never enter the atom
  // (and event growth during the drag cannot fight the user).
  const beginScrub = useCallback(() => {
    setScrubIndex((prev) =>
      prev != null ? prev : clampIndex(currentIndex, events.length)
    );
  }, [currentIndex, events.length]);

  const scrub = useCallback(
    (index: number) => {
      setScrubIndex(clampIndex(index, events.length));
    },
    [events.length]
  );

  const endScrub = useCallback(
    (index: number) => {
      const final = clampIndex(index, events.length);
      setScrubIndex(null);
      // Pause playback when scrubbing ends — a scrub is an explicit "I'm
      // taking the wheel" action, identical to pressing pause + step.
      setIsPlayingLocal(false);
      patchCellState({
        currentIndex: final,
        isPlaying: false,
        hasUserOverride: true,
      });
      setCurrentIndexLocal(final);
    },
    [events.length, patchCellState, setCurrentIndexLocal]
  );

  // ── Return ───────────────────────────────────────────────────────────
  const state: CellReplayState = useMemo(
    () => ({
      currentIndex: safeIndex,
      isPlaying: !isRemoved && isPlaying,
      playbackSpeed,
      currentEvent,
      totalEvents: events.length,
      progress,
      mode,
      isDetached,
    }),
    [
      safeIndex,
      isPlaying,
      isRemoved,
      playbackSpeed,
      currentEvent,
      events.length,
      progress,
      mode,
      isDetached,
    ]
  );

  const controls: CellReplayControls = useMemo(
    () => ({
      play,
      pause,
      togglePlay,
      next,
      prev,
      goToIndex,
      goToProgress,
      setSpeed,
      reset,
      goToEnd,
      syncToMain,
      beginScrub,
      scrub,
      endScrub,
    }),
    [
      play,
      pause,
      togglePlay,
      next,
      prev,
      goToIndex,
      goToProgress,
      setSpeed,
      reset,
      goToEnd,
      syncToMain,
      beginScrub,
      scrub,
      endScrub,
    ]
  );

  return { state, controls };
}
