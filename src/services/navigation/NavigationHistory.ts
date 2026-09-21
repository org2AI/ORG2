/**
 * NavigationHistory - Editor Location History (pure model)
 *
 * Browser-style history of editor locations: recording a visit truncates any
 * forward entries and appends, while `back()` / `forward()` walk the ring and
 * hand back the location to restore.
 *
 * This module is deliberately dependency-free. It owns bookkeeping only —
 * opening files and moving the caret belongs to CodeNavigationService, which
 * drives this model. Keeping it a leaf also keeps the service graph acyclic:
 * FileOperationsService records visits here, and CodeNavigationService imports
 * both.
 *
 * Usage:
 *   import { NavigationHistory } from "@src/services/navigation";
 *   NavigationHistory.recordVisit({ filePath, line, column });
 */

export interface NavigationLocation {
  filePath: string;
  line: number;
  column: number;
}

const navigationHistory: NavigationLocation[] = [];
let historyIndex = -1;
/** Depth of in-flight back/forward replays; visits are not recorded while > 0. */
let replayDepth = 0;
const MAX_NAVIGATION_HISTORY = 100;

function isSameLocation(
  left: NavigationLocation,
  right: NavigationLocation
): boolean {
  return (
    left.filePath === right.filePath &&
    left.line === right.line &&
    left.column === right.column
  );
}

export const NavigationHistory = {
  /**
   * Record a visited location.
   *
   * Ignored while a back/forward replay is in flight — restoring an entry must
   * not append it again — and when the location already sits at the cursor, so
   * re-opening the same place is not a history entry.
   *
   * @returns whether the location was appended
   */
  recordVisit(location: NavigationLocation): boolean {
    if (replayDepth > 0) {
      return false;
    }

    const current = navigationHistory[historyIndex];
    if (current && isSameLocation(current, location)) {
      return false;
    }

    // Visiting a new location drops anything we could have gone forward to.
    navigationHistory.splice(historyIndex + 1);
    navigationHistory.push(location);

    if (navigationHistory.length > MAX_NAVIGATION_HISTORY) {
      navigationHistory.splice(
        0,
        navigationHistory.length - MAX_NAVIGATION_HISTORY
      );
    }

    historyIndex = navigationHistory.length - 1;
    return true;
  },

  /**
   * Step back one entry.
   *
   * @returns the location to restore, or null when there is no earlier entry
   */
  back(): NavigationLocation | null {
    if (historyIndex <= 0) {
      return null;
    }
    historyIndex--;
    return navigationHistory[historyIndex];
  },

  /**
   * Step forward one entry.
   *
   * @returns the location to restore, or null when there is no later entry
   */
  forward(): NavigationLocation | null {
    if (historyIndex >= navigationHistory.length - 1) {
      return null;
    }
    historyIndex++;
    return navigationHistory[historyIndex];
  },

  /**
   * Run a restore without recording it, so replaying history does not rewrite
   * it. Nested replays are counted, and the depth is released even if `run`
   * throws.
   */
  async replay<T>(run: () => Promise<T>): Promise<T> {
    replayDepth++;
    try {
      return await run();
    } finally {
      replayDepth = Math.max(0, replayDepth - 1);
    }
  },

  /** Clear navigation history */
  clearHistory(): void {
    navigationHistory.length = 0;
    historyIndex = -1;
    replayDepth = 0;
  },

  /** Get current history for debugging and tests */
  getHistory(): { locations: NavigationLocation[]; index: number } {
    return {
      locations: [...navigationHistory],
      index: historyIndex,
    };
  },
};
