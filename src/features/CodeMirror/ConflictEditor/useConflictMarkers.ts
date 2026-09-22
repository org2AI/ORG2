/**
 * Conflict marker parsing utilities
 *
 * Parses conflict markers from file content and provides
 * utilities for conflict resolution.
 */
import type { ConflictBlock } from "./types";

// Conflict marker patterns (with multiline flag for proper detection)
const MARKER_PATTERNS = {
  /** Start of current (HEAD) section: <<<<<<< label */
  currentStart: /^<{7}\s*(.*)$/m,
  /** Separator between current and incoming: ======= */
  separator: /^={7}$/m,
  /** End of incoming section: >>>>>>> label */
  incomingEnd: /^>{7}\s*(.*)$/m,
};

/**
 * Generate unique ID for a conflict block
 */
function generateConflictId(lineNumber: number): string {
  return `conflict-${lineNumber}`;
}

/**
 * Parse conflict blocks from content
 */
function parseConflictBlocks(content: string): ConflictBlock[] {
  const lines = content.split("\n");
  const conflicts: ConflictBlock[] = [];

  let inConflict = false;
  let inCurrentSection = false;
  let currentLines: string[] = [];
  let incomingLines: string[] = [];
  let currentLabel = "";
  let markerStartLine = 0;
  let separatorLine = 0;
  const _currentStartLine = 0;
  const _currentEndLine = 0;
  const _incomingStartLine = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Check for conflict start marker
    const currentMatch = line.match(MARKER_PATTERNS.currentStart);
    if (currentMatch) {
      inConflict = true;
      inCurrentSection = true;
      currentLabel = currentMatch[1] || "HEAD";
      markerStartLine = lineIdx;
      currentLines = [];
      incomingLines = [];
      continue;
    }

    // Check for separator
    if (inConflict && MARKER_PATTERNS.separator.test(line)) {
      inCurrentSection = false;
      separatorLine = lineIdx;
      continue;
    }

    // Check for conflict end marker
    const incomingMatch = line.match(MARKER_PATTERNS.incomingEnd);
    if (inConflict && incomingMatch) {
      const incomingLabel = incomingMatch[1] || "incoming";

      conflicts.push({
        id: generateConflictId(markerStartLine),
        startLine: markerStartLine,
        endLine: lineIdx,
        markerStartLine,
        separatorLine,
        markerEndLine: lineIdx,
        currentContent: currentLines.join("\n"),
        incomingContent: incomingLines.join("\n"),
        currentLabel,
        incomingLabel,
        resolved: false,
      });

      inConflict = false;
      inCurrentSection = false;
      continue;
    }

    // Collect content lines
    if (inConflict) {
      if (inCurrentSection) {
        currentLines.push(line);
      } else {
        incomingLines.push(line);
      }
    }
  }

  return conflicts;
}

/**
 * Check if content has conflict markers
 */
function hasConflictMarkers(content: string): boolean {
  return (
    MARKER_PATTERNS.currentStart.test(content) &&
    MARKER_PATTERNS.separator.test(content) &&
    MARKER_PATTERNS.incomingEnd.test(content)
  );
}

// Export utilities for external use
export { parseConflictBlocks, hasConflictMarkers };
