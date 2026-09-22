import {
  type RecentModelEntry,
  recentEntriesEquivalent,
} from "@src/store/session/recentModelEntriesAtom";
import { MAX_SPOTLIGHT_MODEL_PINS } from "@src/store/ui/spotlightPinsAtom";

export function isModelPinned(
  pins: readonly RecentModelEntry[],
  entry: RecentModelEntry
): boolean {
  return pins.some((pin) => recentEntriesEquivalent(pin, entry));
}

/** Pin identity is the Recent-row identity: model family + key. */
export function toggleModelPin(
  pins: readonly RecentModelEntry[],
  entry: RecentModelEntry
): RecentModelEntry[] {
  if (isModelPinned(pins, entry)) {
    return pins.filter((pin) => !recentEntriesEquivalent(pin, entry));
  }
  return pins.length < MAX_SPOTLIGHT_MODEL_PINS ? [...pins, entry] : [...pins];
}
