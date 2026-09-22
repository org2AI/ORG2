const MAX_DRAFT_RESTORE_CHARS = 20_000;
const MAX_DRAFT_RESTORE_LINES = 500;
const MAX_DRAFT_RESTORE_BRACKETS = 500;

export function getDraftRestoreSkipReason(draftText: string): string | null {
  if (draftText.length > MAX_DRAFT_RESTORE_CHARS) return "too_large";

  let lineCount = 1;
  let bracketCount = 0;
  for (const char of draftText) {
    if (char === "\n") {
      lineCount += 1;
      if (lineCount > MAX_DRAFT_RESTORE_LINES) return "too_many_lines";
    }
    if (char === "[") {
      bracketCount += 1;
      if (bracketCount > MAX_DRAFT_RESTORE_BRACKETS) {
        return "too_many_pill_candidates";
      }
    }
  }

  return null;
}
