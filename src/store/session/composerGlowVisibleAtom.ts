import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const COMPOSER_GLOW_VISIBLE_STORAGE_KEY = "orgii:composer:glowVisible";

function normalizeComposerGlowVisible(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

const storedComposerGlowVisibleAtom = atomWithStorage<unknown>(
  COMPOSER_GLOW_VISIBLE_STORAGE_KEY,
  true,
  undefined,
  { getOnInit: true }
);

/**
 * Whether composer shells draw the primary glow beneath them, in both the
 * session creator and the in-session composer. Presentation only: the neutral
 * edge shadow and focus ring stay.
 */
export const composerGlowVisibleAtom = atom(
  (get) => normalizeComposerGlowVisible(get(storedComposerGlowVisibleAtom)),
  (_get, set, visible: boolean) => set(storedComposerGlowVisibleAtom, visible)
);

composerGlowVisibleAtom.debugLabel = "composerGlowVisibleAtom";
