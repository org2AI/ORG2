/**
 * Link Open Target Atom
 *
 * Where a plain click on a web link in rendered content opens: the
 * workstation Browser (`internal`, the default and the behavior from before
 * this preference existed) or the operating system's default browser
 * (`external`). Chosen from the session menu's Navigation submenu.
 *
 * Click handlers call `readLinkOpenTarget()` at click time instead of
 * subscribing. A transcript renders one Markdown instance per message, and a
 * storage read is always current: an unmounted storage atom keeps the value
 * it hydrated with, so it would miss a change made in another window.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

export const LINK_OPEN_TARGETS = ["internal", "external"] as const;

export type LinkOpenTarget = (typeof LINK_OPEN_TARGETS)[number];

export const LINK_OPEN_TARGET_STORAGE_KEY = "orgii:navigation:linkOpenTarget";

const DEFAULT_LINK_OPEN_TARGET: LinkOpenTarget = "internal";

const linkOpenTargetStorage = createZodJsonStorage(z.enum(LINK_OPEN_TARGETS));

export const linkOpenTargetAtom = atomWithStorage<LinkOpenTarget>(
  LINK_OPEN_TARGET_STORAGE_KEY,
  DEFAULT_LINK_OPEN_TARGET,
  linkOpenTargetStorage,
  { getOnInit: true }
);
linkOpenTargetAtom.debugLabel = "linkOpenTargetAtom";

/** The persisted choice, falling back to `internal` when unset or malformed. */
export function readLinkOpenTarget(): LinkOpenTarget {
  return linkOpenTargetStorage.getItem(
    LINK_OPEN_TARGET_STORAGE_KEY,
    DEFAULT_LINK_OPEN_TARGET
  );
}
