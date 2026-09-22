import { useRef } from "react";

import { useElementDimensions } from "./useElementDimensions";

/** Leave at least 444px for content beside the standard 256px details rail. */
export const DETAIL_RAIL_BREAKPOINT = 700;

export function useDetailRailLayout(enabled = true) {
  const paneRef = useRef<HTMLDivElement>(null);
  const width = useElementDimensions(paneRef, {
    dimension: "width",
    enabled,
  });

  return {
    paneRef,
    // Unknown/hidden widths retain the desktop layout until measured.
    inlineRail: width > 0 && width < DETAIL_RAIL_BREAKPOINT,
  };
}
