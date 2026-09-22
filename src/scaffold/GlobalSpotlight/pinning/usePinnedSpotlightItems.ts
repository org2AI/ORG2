import { useAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  type SpotlightPinScope,
  spotlightPinAtoms,
} from "@src/store/ui/spotlightPinsAtom";

import type { SpotlightItem } from "../types";
import { buildPinnedItems, togglePinnedId } from "./pinnedItems";

/** Scopes whose pins are row ids; model pins are whole selections. */
export type ListPinScope = Exclude<SpotlightPinScope, "models">;

const PIN_SCOPES = {
  commands: {
    atom: spotlightPinAtoms.commands,
    canPin: (item: SpotlightItem) =>
      item.type === "action" || item.type === "page" || item.type === "command",
  },
  directories: {
    atom: spotlightPinAtoms.directories,
    canPin: (item: SpotlightItem) => item.type === "repo",
  },
  // Agent rows opt in with a `pinId` shared by their Recent and group copies.
  agents: {
    atom: spotlightPinAtoms.agents,
    canPin: (item: SpotlightItem) => Boolean(item.data?.pinId),
  },
} as const;

export function usePinnedSpotlightItems(
  items: SpotlightItem[],
  scope: ListPinScope,
  enabled = true
): SpotlightItem[] {
  const { atom, canPin } = PIN_SCOPES[scope];
  const [ids, setIds] = useAtom(atom);
  const { t } = useTranslation();
  const toggle = useCallback(
    (id: string) => setIds((previous) => togglePinnedId(previous, id)),
    [setIds]
  );
  return useMemo(
    () =>
      enabled
        ? buildPinnedItems(
            items,
            ids,
            toggle,
            t("selectors.repo.sections.pinned"),
            canPin
          )
        : items,
    [items, ids, toggle, t, canPin, enabled]
  );
}
