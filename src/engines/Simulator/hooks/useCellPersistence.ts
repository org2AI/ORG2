/**
 * useCellPersistence Hook
 *
 * Manages per-cell persisted state (currentIndex, isPlaying, hasUserOverride)
 * via the global cellReplayStatesAtom. Uses a focused derived atom so writes
 * from other cells don't trigger re-renders here.
 */
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type CellReplayOwner,
  type CellReplayPersistState,
  cellReplayStatesAtom,
  registerCellReplayOwnerAtom,
} from "@src/store/ui/simulatorAtom";

export interface CellPersistenceReturn {
  /** This cell's persisted state (may be undefined if never persisted). */
  persistedState: CellReplayPersistState | undefined;
  /** Whether the user has manually detached this cell from the main cursor. */
  hasUserOverride: boolean;
  /** Session removal revokes this mount until its parent replaces it. */
  isRemoved: boolean;
  /** Patch this cell's slice of the global persisted state. */
  patchCellState: (patch: Partial<CellReplayPersistState>) => void;
}

export function useCellPersistence(cellId: string): CellPersistenceReturn {
  const setCellStates = useSetAtom(cellReplayStatesAtom);
  const registerOwner = useSetAtom(registerCellReplayOwnerAtom);
  const ownerRef = useRef<CellReplayOwner | null>(null);
  const [isRemoved, setIsRemoved] = useState(false);

  useEffect(() => {
    const owner: CellReplayOwner = {
      cellId,
      active: true,
      onRemove: () => setIsRemoved(true),
    };
    ownerRef.current = owner;
    return registerOwner(owner);
  }, [cellId, registerOwner]);

  const persistedState = useAtomValue(
    useMemo(
      () =>
        atom((get) => {
          const states = get(cellReplayStatesAtom);
          return states[cellId];
        }),
      [cellId]
    )
  );

  // A remounted cell counts as recent without retaining its component owner.
  useEffect(() => {
    setCellStates((states) => {
      const saved = states[cellId];
      if (!saved || Object.keys(states).at(-1) === cellId) return states;
      const next = { ...states };
      delete next[cellId];
      next[cellId] = saved;
      return next;
    });
  }, [cellId, setCellStates]);

  const hasUserOverride = persistedState?.hasUserOverride ?? false;

  const patchCellState = useCallback(
    (patch: Partial<CellReplayPersistState>) => {
      if (!ownerRef.current?.active) return;
      setCellStates((states) => {
        const prev = states[cellId];
        const next = {
          ...(prev ?? { currentIndex: 0, isPlaying: false }),
          ...patch,
        };
        if (
          prev &&
          prev.currentIndex === next.currentIndex &&
          prev.isPlaying === next.isPlaying &&
          prev.hasUserOverride === next.hasUserOverride
        ) {
          return states;
        }
        const updated = { ...states };
        delete updated[cellId];
        updated[cellId] = next;
        return updated;
      });
    },
    [cellId, setCellStates]
  );

  return { persistedState, hasUserOverride, patchCellState, isRemoved };
}
