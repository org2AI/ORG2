import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const COMPACT_COMPOSER_INPUT_STORAGE_KEY = "orgii:composer:compactInput";

function normalizeCompactComposerInput(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

const storedCompactComposerInputAtom = atomWithStorage<unknown>(
  COMPACT_COMPOSER_INPUT_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

/**
 * Composer preference for collapsing an idle chat input into the one-row
 * capsule. Off by default, so every composer keeps the full-size stacked
 * editor until the user opts in from the session menu's Input settings.
 *
 * The preference only chooses the idle presentation of composers inside the
 * full-screen (maximized) chat panel; a split chat panel keeps the full-size
 * editor, and an enabled composer still expands whenever its content needs
 * the stacked editor (see `shouldUseCompactComposerLayout` and
 * `useEditorExpansion`).
 */
export const compactComposerInputAtom = atom(
  (get) => normalizeCompactComposerInput(get(storedCompactComposerInputAtom)),
  (_get, set, enabled: boolean) => set(storedCompactComposerInputAtom, enabled)
);

compactComposerInputAtom.debugLabel = "compactComposerInputAtom";
