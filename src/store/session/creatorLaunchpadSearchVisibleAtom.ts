import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY =
  "orgii:sessionCreator:launchpadSearchVisible";

function normalizeCreatorLaunchpadSearchVisible(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

const storedCreatorLaunchpadSearchVisibleAtom = atomWithStorage<unknown>(
  CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY,
  true,
  undefined,
  { getOnInit: true }
);

/**
 * Whether the launchpad header shows its Spotlight search trigger. The
 * preference only changes presentation; Spotlight stays reachable through its
 * keyboard shortcut and other entry points.
 */
export const creatorLaunchpadSearchVisibleAtom = atom(
  (get) =>
    normalizeCreatorLaunchpadSearchVisible(
      get(storedCreatorLaunchpadSearchVisibleAtom)
    ),
  (_get, set, visible: boolean) =>
    set(storedCreatorLaunchpadSearchVisibleAtom, visible)
);

creatorLaunchpadSearchVisibleAtom.debugLabel =
  "creatorLaunchpadSearchVisibleAtom";
