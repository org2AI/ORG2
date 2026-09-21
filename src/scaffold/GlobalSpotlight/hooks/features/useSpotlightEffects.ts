import { useAtom } from "jotai";
import { type Dispatch, useEffect, useLayoutEffect } from "react";

import {
  type SpotlightInitialQuery,
  spotlightInitialQueryAtom,
} from "@src/store/ui/uiAtom";

import type { SpotlightAction } from "../core/types";

interface UseSpotlightEffectsOptions {
  isOpen: boolean;
  dispatch: Dispatch<SpotlightAction>;
  onRequest: (request: SpotlightInitialQuery) => void;
}

/** Consume requests using dialog visibility, even while a child owns the body. */
export function useSpotlightEffects({
  isOpen,
  dispatch,
  onRequest,
}: UseSpotlightEffectsOptions): void {
  const [request, setRequest] = useAtom(spotlightInitialQueryAtom);
  useEffect(() => {
    if (!isOpen) dispatch({ type: "RESET" });
  }, [isOpen, dispatch]);
  useLayoutEffect(() => {
    if (!isOpen || !request) return;
    setRequest(null);
    dispatch({ type: "RESET" });
    onRequest(request);
    if (!request.layer || request.layer.kind === "default") {
      dispatch({ type: "SET_SEARCH_QUERY", payload: { query: request.query } });
    }
  }, [isOpen, request, setRequest, dispatch, onRequest]);
}
