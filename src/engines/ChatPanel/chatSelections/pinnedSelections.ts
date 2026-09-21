/**
 * Pinned chat selections — the transcript passages a user pins into the
 * workstation trail.
 *
 * A pin is a local reading mark, not session content: it never reaches the
 * agent and never leaves this machine. Storage is therefore per-session
 * localStorage and best-effort — pinning still works for the open session
 * when storage is unavailable, the pins just do not survive a restart.
 */

export interface PinnedChatSelection {
  id: string;
  /** The selected passage, normalized and capped. */
  text: string;
  /**
   * Transcript anchor (`data-transcript-anchor-id`) the passage was taken
   * from. Recorded at pin time so a row can later scroll back to its origin;
   * absent when the selection spanned no anchored group.
   */
  anchorId?: string;
  createdAt: number;
}

const STORAGE_KEY_PREFIX = "orgii:chatPinnedSelections:";

/** A pinned passage is a reading mark, not an archive of the message. */
export const PINNED_SELECTION_TEXT_LIMIT = 2000;
/** Newest pins win once a session is this deep; the tail is dropped. */
export const PINNED_SELECTIONS_PER_SESSION = 50;
/** Row labels are one line of a rail that is 200-odd pixels wide. */
export const PINNED_SELECTION_LABEL_LIMIT = 120;

export function pinnedSelectionsStorageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

/** Trim and cap a raw DOM selection into what a pin may hold. */
export function normalizePinnedSelectionText(text: string): string {
  return text.trim().slice(0, PINNED_SELECTION_TEXT_LIMIT);
}

/**
 * One-line label for a rail row: newlines and runs of whitespace collapse to
 * single spaces so a multi-line passage still reads as a sentence.
 */
export function derivePinnedSelectionLabel(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= PINNED_SELECTION_LABEL_LIMIT) return collapsed;
  return `${collapsed.slice(0, PINNED_SELECTION_LABEL_LIMIT - 1).trimEnd()}…`;
}

function isPinnedChatSelection(value: unknown): value is PinnedChatSelection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PinnedChatSelection>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.text === "string" &&
    candidate.text.length > 0 &&
    typeof candidate.createdAt === "number" &&
    (candidate.anchorId === undefined || typeof candidate.anchorId === "string")
  );
}

export function readPinnedSelections(sessionId: string): PinnedChatSelection[] {
  if (!sessionId) return [];
  try {
    const raw = localStorage.getItem(pinnedSelectionsStorageKey(sessionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isPinnedChatSelection)
      .slice(0, PINNED_SELECTIONS_PER_SESSION);
  } catch {
    // Unreadable or corrupt storage reads as "no pins" rather than breaking
    // the rail; the next successful write replaces it.
    return [];
  }
}

export function writePinnedSelections(
  sessionId: string,
  pins: PinnedChatSelection[]
): void {
  if (!sessionId) return;
  try {
    const key = pinnedSelectionsStorageKey(sessionId);
    if (pins.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(pins));
  } catch {
    // The pins still show in the trail for this session.
  }
}

/**
 * Prepend a pin so a fresh one is the first row in the rail. Re-pinning the
 * same passage moves the existing pin to the top instead of duplicating it.
 */
export function appendPinnedSelection(
  pins: PinnedChatSelection[],
  pin: PinnedChatSelection
): PinnedChatSelection[] {
  const withoutDuplicate = pins.filter(
    (existing) => existing.text !== pin.text
  );
  return [pin, ...withoutDuplicate].slice(0, PINNED_SELECTIONS_PER_SESSION);
}

export function removePinnedSelection(
  pins: PinnedChatSelection[],
  id: string
): PinnedChatSelection[] {
  return pins.filter((pin) => pin.id !== id);
}

export function createPinnedSelection(
  text: string,
  anchorId?: string
): PinnedChatSelection | null {
  const normalized = normalizePinnedSelectionText(text);
  if (!normalized) return null;
  return {
    id: `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text: normalized,
    anchorId,
    createdAt: Date.now(),
  };
}
