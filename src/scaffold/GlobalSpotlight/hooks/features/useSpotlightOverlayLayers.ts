import { useCallback, useEffect, useRef, useState } from "react";

import type { SpotlightInitialLayer } from "@src/store/ui/uiAtom";

import type { BranchPaletteMode } from "../../palettes/BranchPalette";

const ROOT_LAYER: SpotlightInitialLayer = { kind: "default" };

/** Exactly one layer owns the body and keyboard navigation. */
export function useSpotlightOverlayLayers(isOpen: boolean) {
  const [activeLayer, setActiveLayer] =
    useState<SpotlightInitialLayer>(ROOT_LAYER);
  const [editorQuery, setEditorQuery] = useState("");
  const [embeddedBranchMode, setEmbeddedBranchMode] =
    useState<BranchPaletteMode>("checkout");
  const lastActivatedItemIdRef = useRef<string | null>(null);
  const [pendingRestoreItemId, setPendingRestoreItemId] = useState<
    string | null
  >(null);
  const restoreLastActivatedItem = useCallback(() => {
    setPendingRestoreItemId(lastActivatedItemIdRef.current);
  }, []);
  const openLayer = useCallback((layer: SpotlightInitialLayer, query = "") => {
    setActiveLayer(layer);
    setEditorQuery(layer.kind === "editor" ? query : "");
    setEmbeddedBranchMode("checkout");
    setPendingRestoreItemId(null);
  }, []);
  const closeLayer = useCallback(() => {
    setActiveLayer(ROOT_LAYER);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);
  useEffect(() => {
    if (isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      openLayer(ROOT_LAYER);
      lastActivatedItemIdRef.current = null;
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, openLayer]);
  return {
    activeLayer,
    editorQuery,
    openLayer,
    closeLayer,
    isRootActive: isOpen && activeLayer.kind === "default",
    embeddedBranchMode,
    setEmbeddedBranchMode,
    lastActivatedItemIdRef,
    pendingRestoreItemId,
    setPendingRestoreItemId,
    restoreLastActivatedItem,
  };
}
