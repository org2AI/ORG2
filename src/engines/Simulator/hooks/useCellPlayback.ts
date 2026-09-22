/**
 * useCellPlayback Hook
 *
 * Manages the auto-play timer for a single grid cell. Separated from
 * useCellReplayState for maintainability.
 */
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";

import type { SessionEvent } from "@src/engines/SessionCore";
import type { CellReplayPersistState } from "@src/store/ui/simulatorAtom";

export interface UseCellPlaybackOptions {
  enabled: boolean;
  events: SessionEvent[];
  autoPlayInterval: number;
  isPlaying: boolean;
  isSyncMode: boolean;
  playbackSpeed: number;
  setCurrentIndexLocal: Dispatch<SetStateAction<number>>;
  setIsPlayingLocal: Dispatch<SetStateAction<boolean>>;
  patchCellState: (patch: Partial<CellReplayPersistState>) => void;
}

/**
 * Runs the auto-play timer (independent mode only), while the cell is playing
 * and the document is visible.
 */
export function useCellPlayback({
  enabled,
  events,
  autoPlayInterval,
  isPlaying,
  isSyncMode,
  playbackSpeed,
  setCurrentIndexLocal,
  setIsPlayingLocal,
  patchCellState,
}: UseCellPlaybackOptions): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-play timer — only in independent mode
  useEffect(() => {
    if (!enabled || isSyncMode || !isPlaying || events.length === 0) return;
    const stopTimer = () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const updateVisibility = () => {
      stopTimer();
      if (document.visibilityState === "hidden") return;
      timerRef.current = setInterval(() => {
        setCurrentIndexLocal((prev) => {
          const nextIndex = prev + 1;
          if (nextIndex >= events.length) {
            setIsPlayingLocal(false);
            patchCellState({ currentIndex: prev, isPlaying: false });
            return prev;
          }
          patchCellState({ currentIndex: nextIndex, isPlaying: true });
          return nextIndex;
        });
      }, autoPlayInterval / playbackSpeed);
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [
    enabled,
    isPlaying,
    isSyncMode,
    events.length,
    autoPlayInterval,
    playbackSpeed,
    patchCellState,
    setCurrentIndexLocal,
    setIsPlayingLocal,
  ]);
}
