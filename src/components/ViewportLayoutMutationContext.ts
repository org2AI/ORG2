import { createContext, useContext } from "react";

export type BeforeViewportLayoutMutation = () => void;

/**
 * Optional contract between a scroll owner and nested controls that explicitly
 * change content height. The owner can capture its reading anchor before the
 * mutation; controls outside such a viewport keep their existing behavior.
 */
const ViewportLayoutMutationContext =
  createContext<BeforeViewportLayoutMutation | null>(null);

export const ViewportLayoutMutationProvider =
  ViewportLayoutMutationContext.Provider;

export function useBeforeViewportLayoutMutation(): BeforeViewportLayoutMutation | null {
  return useContext(ViewportLayoutMutationContext);
}
