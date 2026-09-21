import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import {
  type RecentModelEntry,
  RecentModelEntrySchema,
} from "@src/store/session/recentModelEntriesAtom";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

/** Local UI preferences; retain only identities, never rows or action closures. */
export const spotlightCommandPinsAtom = atomWithStorage<string[]>(
  "orgii-spotlight-command-pins",
  []
);
export const spotlightDirectoryPinsAtom = atomWithStorage<string[]>(
  "orgii-spotlight-directory-pins",
  []
);
export const spotlightAgentPinsAtom = atomWithStorage<string[]>(
  "orgii-spotlight-agent-pins",
  []
);

export const MAX_SPOTLIGHT_MODEL_PINS = 20;

/** A pinned model is a whole model + key selection, like a Recent row. */
export const spotlightModelPinsAtom = atomWithStorage<RecentModelEntry[]>(
  "orgii-spotlight-model-pins",
  [],
  createZodJsonStorage(
    z
      .array(RecentModelEntrySchema)
      .transform((entries) => entries.slice(0, MAX_SPOTLIGHT_MODEL_PINS))
  )
);

export type SpotlightPinScope =
  | "commands"
  | "directories"
  | "agents"
  | "models";

/** Each Spotlight surface owns exactly one pin list. */
export const spotlightPinAtoms = {
  commands: spotlightCommandPinsAtom,
  directories: spotlightDirectoryPinsAtom,
  agents: spotlightAgentPinsAtom,
  models: spotlightModelPinsAtom,
} as const;
