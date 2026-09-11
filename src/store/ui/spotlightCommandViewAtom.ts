import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type SpotlightCommandView = "gui" | "tui";

const storedViewAtom = atomWithStorage<unknown>(
  "orgii-spotlight-command-view",
  "tui",
  undefined,
  { getOnInit: true }
);

/** One local presentation preference, independent of agent execution mode. */
export const spotlightCommandViewAtom = atom(
  (get): SpotlightCommandView =>
    get(storedViewAtom) === "gui" ? "gui" : "tui",
  (_get, set, view: SpotlightCommandView) => set(storedViewAtom, view)
);
