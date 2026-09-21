import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const SEPARATE_EFFORT_PILL_STORAGE_KEY =
  "orgii:composer:separateEffortPill";

function normalizeSeparateEffortPill(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

const storedSeparateEffortPillAtom = atomWithStorage<unknown>(
  SEPARATE_EFFORT_PILL_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

/**
 * Composer preference that splits the combined model pill in two. When on,
 * the model pill opens the model picker directly and effort gets its own
 * pill; picking a model keeps the current effort (see
 * `carryModelEffort`) instead of adopting the row's per-key default variant.
 */
export const separateEffortPillAtom = atom(
  (get) => normalizeSeparateEffortPill(get(storedSeparateEffortPillAtom)),
  (_get, set, enabled: boolean) => set(storedSeparateEffortPillAtom, enabled)
);

separateEffortPillAtom.debugLabel = "separateEffortPillAtom";
