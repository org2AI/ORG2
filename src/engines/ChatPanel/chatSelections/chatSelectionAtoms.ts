/**
 * Cross-surface state for chat text selections.
 *
 * Both actions on a selection are written in the transcript and read
 * somewhere else — a pin by the workstation trail, a quote by the composer —
 * so neither can live in the selecting component. Both are keyed by session:
 * a split view has one composer and one trail per session.
 *
 * Pins hydrate lazily from localStorage on first read of a session and are
 * written through on every mutation.
 */
import { atom } from "jotai";

import {
  type PinnedChatSelection,
  appendPinnedSelection,
  createPinnedSelection,
  readPinnedSelections,
  removePinnedSelection,
  writePinnedSelections,
} from "./pinnedSelections";
import { normalizeQuotedSelection } from "./quotedReply";

export const EMPTY_PINNED_SELECTIONS: PinnedChatSelection[] = [];

/** Pinned passages by session id. Absent key = not hydrated yet. */
export const pinnedChatSelectionsAtom = atom<
  Record<string, PinnedChatSelection[]>
>({});
pinnedChatSelectionsAtom.debugLabel = "pinnedChatSelectionsAtom";

/** Hydrate a session's pins from storage once; later reads are in-memory. */
export const hydratePinnedChatSelectionsAtom = atom(
  null,
  (get, set, sessionId: string) => {
    if (!sessionId) return;
    const current = get(pinnedChatSelectionsAtom);
    if (current[sessionId]) return;
    set(pinnedChatSelectionsAtom, {
      ...current,
      [sessionId]: readPinnedSelections(sessionId),
    });
  }
);

export const pinChatSelectionAtom = atom(
  null,
  (
    get,
    set,
    {
      sessionId,
      text,
      anchorId,
    }: { sessionId: string; text: string; anchorId?: string }
  ) => {
    if (!sessionId) return;
    const pin = createPinnedSelection(text, anchorId);
    if (!pin) return;
    const current = get(pinnedChatSelectionsAtom);
    const existing = current[sessionId] ?? readPinnedSelections(sessionId);
    const next = appendPinnedSelection(existing, pin);
    set(pinnedChatSelectionsAtom, { ...current, [sessionId]: next });
    writePinnedSelections(sessionId, next);
  }
);

export const unpinChatSelectionAtom = atom(
  null,
  (get, set, { sessionId, id }: { sessionId: string; id: string }) => {
    if (!sessionId) return;
    const current = get(pinnedChatSelectionsAtom);
    const existing = current[sessionId] ?? readPinnedSelections(sessionId);
    const next = removePinnedSelection(existing, id);
    if (next.length === existing.length) return;
    set(pinnedChatSelectionsAtom, { ...current, [sessionId]: next });
    writePinnedSelections(sessionId, next);
  }
);

/**
 * The passage the composer is replying to, by session. Transient: a quote is
 * a property of the message being typed, and the composer clears it on send.
 */
export const chatQuotedSelectionsAtom = atom<Record<string, string>>({});
chatQuotedSelectionsAtom.debugLabel = "chatQuotedSelectionsAtom";

export const setChatQuotedSelectionAtom = atom(
  null,
  (get, set, { sessionId, text }: { sessionId: string; text: string }) => {
    if (!sessionId) return;
    const normalized = normalizeQuotedSelection(text);
    if (!normalized) return;
    set(chatQuotedSelectionsAtom, {
      ...get(chatQuotedSelectionsAtom),
      [sessionId]: normalized,
    });
  }
);

export const clearChatQuotedSelectionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(chatQuotedSelectionsAtom);
    if (!(sessionId in current)) return;
    const next = { ...current };
    delete next[sessionId];
    set(chatQuotedSelectionsAtom, next);
  }
);
