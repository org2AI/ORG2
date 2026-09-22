import React, { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import type { WorkingDirectoryInitialStage } from "@src/store/ui/overlayAtom";

import type { AddWorkingDirectoryModalStage } from "../../hooks";
import type { AddMenuKind } from "./types";

const log = createLogger("WorkingDirectoryPalette");

interface UseWorkingDirectoryPaletteOpenResetOptions {
  isOpen: boolean;
  effectiveInitialStage: AddWorkingDirectoryModalStage;
  initialAddMenu: boolean;
  initialManageMode: boolean;
  initialAddStageAtom: WorkingDirectoryInitialStage;
  setInitialAddStageAtom: (stage: WorkingDirectoryInitialStage) => void;
  setSearchQuery: (query: string) => void;
  setModalStage: (stage: AddWorkingDirectoryModalStage) => void;
  setAddMenuKind: (kind: AddMenuKind) => void;
  setIsManageMode: (manage: boolean) => void;
  setSelectedIds: (ids: Set<string>) => void;
}

/**
 * Applies the requested initial stage / add menu / manage mode when the
 * palette opens, and clears every transient selection when it closes. State
 * writes are deferred to a microtask so the effect never sets state
 * synchronously during a render commit.
 */
export function useWorkingDirectoryPaletteOpenReset({
  isOpen,
  effectiveInitialStage,
  initialAddMenu,
  initialManageMode,
  initialAddStageAtom,
  setInitialAddStageAtom,
  setSearchQuery,
  setModalStage,
  setAddMenuKind,
  setIsManageMode,
  setSelectedIds,
}: UseWorkingDirectoryPaletteOpenResetOptions): void {
  const wasOpenRef = React.useRef(false);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    let cancelled = false;

    if (isOpen) {
      wasOpenRef.current = true;

      Promise.resolve()
        .then(() => {
          if (cancelled) return;

          if (effectiveInitialStage) {
            setModalStage(effectiveInitialStage);
            setAddMenuKind(null);
            setSearchQuery("");
            if (initialAddStageAtom) {
              setInitialAddStageAtom(null);
            }
          } else if (initialAddMenu) {
            setModalStage(null);
            setAddMenuKind("add");
            setSearchQuery("");
          } else if (!wasOpen) {
            setModalStage(null);
            setAddMenuKind(null);
          }

          if (initialManageMode) {
            setIsManageMode(true);
          }
        })
        .catch((error: unknown) => {
          log.warn("failed to apply palette open state", { error });
        });
    }

    if (!isOpen && wasOpen) {
      wasOpenRef.current = false;
      Promise.resolve()
        .then(() => {
          if (cancelled) return;
          setSearchQuery("");
          setModalStage(null);
          setAddMenuKind(null);
          setIsManageMode(false);
          setSelectedIds(new Set());
        })
        .catch((error: unknown) => {
          log.warn("failed to reset palette close state", { error });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    effectiveInitialStage,
    initialAddMenu,
    initialManageMode,
    initialAddStageAtom,
    setInitialAddStageAtom,
    setSearchQuery,
    setModalStage,
    setAddMenuKind,
    setIsManageMode,
    setSelectedIds,
  ]);
}
