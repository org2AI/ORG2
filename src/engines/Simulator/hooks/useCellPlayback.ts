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
 * Runs the auto-play timer (independent mode only).
 */
export function useCellPlayback({
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
    if (isSyncMode) return;
    if (isPlaying && events.length > 0) {
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
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
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
