import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";

import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import {
  findRecentByCredentialSource,
  recentModelEntriesAtom,
} from "@src/store/session/recentModelEntriesAtom";

/** Local display metadata only: an exact source match never changes routing.
 * Missing or evicted history retains the caller's explicit Market fallback. */
export function useMarketTargetPresentation(
  selection: LastModelSelection | null
): LastModelSelection | null {
  const source = selection?.credentialSource;
  const cachedEntryAtom = useMemo(
    () =>
      selectAtom(recentModelEntriesAtom, (entries) =>
        source?.startsWith("market:")
          ? findRecentByCredentialSource(entries, source)
          : undefined
      ),
    [source]
  );
  const cached = useAtomValue(cachedEntryAtom);
  return useMemo(() => {
    if (!selection || !cached?.accountName?.trim()) return selection;
    return {
      ...selection,
      selectedSourceLabel: cached.accountName,
      marketProfileId: cached.marketProfileId ?? selection.marketProfileId,
    };
  }, [cached, selection]);
}
