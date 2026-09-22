/**
 * Horizontal anchor shared by the Spotlight palette and Spotlight-placed
 * messages, so both sit over the visible content area at the same width.
 * Centering excludes the docked layout sidebar and the focused-chat
 * workstation trail.
 */
import type { CSSProperties } from "react";

import { getSidebarId } from "@src/config/sidebarRegistry";
import {
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "@src/store/ui/sidebarAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

/** Spotlight panel width in pixels. */
export const SPOTLIGHT_WIDTH = 680;
/** Distance from the top of the viewport in pixels. */
export const SPOTLIGHT_TOP_OFFSET = 8;

/** Routes without a docked sidebar, and collapsed sidebars, reserve no width. */
export function getSpotlightSidebarInset(
  pathname: string,
  sidebarWidth: number,
  sidebarCollapsed: boolean
): number {
  return getSidebarId(pathname) !== null && !sidebarCollapsed
    ? sidebarWidth
    : 0;
}

/**
 * The trail's visibility mixes chat focus, tab type, a container query and
 * rail-local collapse state that no atom exposes, so the rendered track is
 * measured instead of mirrored.
 */
export function measureSpotlightTrailInset(): number {
  const track = document.querySelector<HTMLElement>(
    "[data-workstation-trail-track]"
  );
  return track ? track.getBoundingClientRect().width : 0;
}

export function getSpotlightAnchorStyle(
  width: number,
  sidebarInset: number,
  trailInset: number
): Pick<CSSProperties, "left" | "width"> {
  return {
    left: `calc(50% + ${(sidebarInset - trailInset) / 2}px)`,
    width: `min(${width}px, calc(100vw - ${sidebarInset + trailInset}px - 160px))`,
  };
}

/** Imperative variant for surfaces rendered outside the app's React tree. */
export function readSpotlightAnchorStyle(
  width: number = SPOTLIGHT_WIDTH
): Pick<CSSProperties, "left" | "width"> {
  let sidebarInset = 0;
  try {
    const store = getInstrumentedStore();
    sidebarInset = getSpotlightSidebarInset(
      window.location.pathname,
      store.get(sidebarWidthAtom),
      store.get(sidebarCollapsedAtom)
    );
  } catch {
    // Before the app store exists there is no docked sidebar to exclude.
  }
  return getSpotlightAnchorStyle(
    width,
    sidebarInset,
    measureSpotlightTrailInset()
  );
}
