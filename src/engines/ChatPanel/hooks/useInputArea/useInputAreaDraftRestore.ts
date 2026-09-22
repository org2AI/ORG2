import { useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";
import type { useSessionDraftField } from "@src/hooks/session/useSessionPatch";

import { applyParsedContent } from "../../InputArea/utils/pillContentParser";
import { resolveDraftRestoreAction } from "./draftRestore";
import { getDraftRestoreSkipReason } from "./draftRestoreSkipReason";
import type { InputAreaRefs } from "./types";

const logger = createLogger("useInputArea");

interface UseInputAreaDraftRestoreOptions {
  refs: InputAreaRefs;
  draftSessionId: string;
  persistedDraft: ReturnType<typeof useSessionDraftField>["draftText"];
  mentionMenuOpen: boolean;
}

export function useInputAreaDraftRestore({
  refs,
  draftSessionId,
  persistedDraft,
  mentionMenuOpen,
}: UseInputAreaDraftRestoreOptions): void {
  // Mirror the current slash/@ menu open state into a ref so the draft-restore
  // effect can avoid clobbering live input WITHOUT re-running whenever a menu
  // toggles. When a menu is open the user is actively typing into a mounted
  // editor, so a late restore must not clear/re-seed it (see draftRestore.ts).
  const mentionMenuOpenRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- the effect below reads the latest menu state through this ref on purpose so a menu toggle never re-runs the restore
  mentionMenuOpenRef.current = mentionMenuOpen;
  // Track which session id we last seeded the editor with so a re-render
  // (e.g. a draft persisting back into the session row) doesn't re-seed
  // the editor and clobber what the user is currently typing. Only the
  // session-id transition is allowed to touch the editor content here.
  const seededSessionRef = useRef<string | null>(null);

  // Restore the persisted draft into the editor on session switch.
  // We seed exactly once per session id transition: subsequent renders
  // (where `persistedDraft` may be slightly stale relative to the
  // editor — the optimistic upsert in `useSessionPatch` writes back
  // into `sessionByIdAtom`) leave the live editor alone.
  useEffect(() => {
    const editor = refs.composerInputRef.current;
    const skipReason = persistedDraft
      ? getDraftRestoreSkipReason(persistedDraft)
      : null;
    const action = resolveDraftRestoreAction({
      draftSessionId,
      seededSessionId: seededSessionRef.current,
      hasEditor: Boolean(editor),
      mentionMenuOpen: mentionMenuOpenRef.current,
      persistedDraft: persistedDraft ?? null,
      skipReason,
    });

    switch (action) {
      case "reset-seed":
        seededSessionRef.current = null;
        return;
      case "skip":
      case "wait":
        return;
      case "skip-open-menu":
        // User is mid slash/@ interaction — do not clobber live input.
        // Mark seeded so a later render doesn't re-seed and close the menu.
        seededSessionRef.current = draftSessionId;
        return;
      case "clear":
        if (skipReason) {
          logger.warn("skipping persisted draft restore", {
            draftSessionId,
            persistedDraftLength: persistedDraft?.length ?? 0,
            reason: skipReason,
          });
        }
        editor?.clear();
        refs.setHasContent(false);
        seededSessionRef.current = draftSessionId;
        return;
      case "restore":
        if (editor && persistedDraft) {
          applyParsedContent(editor, persistedDraft);
          refs.setHasContent(true);
          seededSessionRef.current = draftSessionId;
        }
        return;
    }
  }, [draftSessionId, persistedDraft, refs]);
}
