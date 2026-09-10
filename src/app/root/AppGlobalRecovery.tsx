/**
 * AppGlobalRecovery
 *
 * Watchdog component that repairs stuck UI drag/resize state caused by
 * mouse-up events that fire outside the window (e.g. user releases the mouse
 * over a native OS element, DevTools, or another window).
 *
 * Stuck states detected:
 * - `document.body.classList` contains `resize-active`
 * - `document.body.style.cursor` is one of the STUCK_CURSORS set
 *
 * Recovery triggers (in order of priority):
 * 1. `mousemove` with no buttons held  → immediate reset
 * 2. `mouseup` / `pointerup`           → debounced reset (150 ms)
 * 3. `blur` / `pointercancel`          → immediate reset
 * 4. `visibilitychange` → hidden       → immediate reset
 *
 * The 150 ms debounce on mouseup/pointerup prevents flicker when a legitimate
 * drag ends inside the window and React still needs one frame to clean up.
 * A new press cancels the fallback. This only repairs DOM residue; interaction
 * owners must also end their own state and listeners when input is interrupted.
 */
import { useEffect } from "react";

const STUCK_CURSORS = new Set([
  "col-resize",
  "row-resize",
  "ew-resize",
  "ns-resize",
  "nwse-resize",
  "nesw-resize",
  "grabbing",
  "move",
  "crosshair",
]);

export function AppGlobalRecovery(): null {
  useEffect(() => {
    let cleanupTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetStuckState = () => {
      document.body.classList.remove("resize-active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.querySelectorAll("iframe").forEach((iframe) => {
        (iframe as HTMLIFrameElement).style.pointerEvents = "";
      });
    };

    const hasStuckState = () =>
      document.body.classList.contains("resize-active") ||
      STUCK_CURSORS.has(document.body.style.cursor);

    const cancelScheduledCleanup = () => {
      if (cleanupTimeoutId !== null) {
        clearTimeout(cleanupTimeoutId);
        cleanupTimeoutId = null;
      }
    };

    const scheduleCleanup = () => {
      if (!hasStuckState()) return;
      if (cleanupTimeoutId) {
        clearTimeout(cleanupTimeoutId);
      }
      cleanupTimeoutId = setTimeout(() => {
        cleanupTimeoutId = null;
        if (hasStuckState()) {
          resetStuckState();
        }
      }, 150);
    };

    const immediateCleanup = () => {
      cancelScheduledCleanup();
      if (hasStuckState()) {
        resetStuckState();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && hasStuckState()) {
        immediateCleanup();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (event.buttons === 0 && hasStuckState()) {
        immediateCleanup();
      }
    };

    // Capture sees releases even when controls stop event propagation. A new
    // press invalidates the previous drag's delayed fallback.
    window.addEventListener("mousedown", cancelScheduledCleanup, true);
    window.addEventListener("pointerdown", cancelScheduledCleanup, true);
    window.addEventListener("pointercancel", immediateCleanup, true);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", scheduleCleanup, true);
    window.addEventListener("pointerup", scheduleCleanup, true);
    window.addEventListener("blur", immediateCleanup);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("mousedown", cancelScheduledCleanup, true);
      window.removeEventListener("pointerdown", cancelScheduledCleanup, true);
      window.removeEventListener("pointercancel", immediateCleanup, true);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", scheduleCleanup, true);
      window.removeEventListener("pointerup", scheduleCleanup, true);
      window.removeEventListener("blur", immediateCleanup);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (cleanupTimeoutId) {
        clearTimeout(cleanupTimeoutId);
      }
    };
  }, []);

  return null;
}
