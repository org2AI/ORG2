import { atom, type createStore } from "jotai";

import {
  ORG2_CLOUD_OFFICIAL_SUPABASE_URL,
  getCloudEndpoint,
} from "@src/features/Org2Cloud/config";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

export type MarketStore = ReturnType<typeof createStore>;
const normalize = (value: string) => value.trim().replace(/\/+$/, "");

/** A token refresh changes no ownership. Custom endpoints never own Market. */
export const marketOwnerKeyAtom = atom((get) => {
  const auth = get(org2CloudAuthAtom);
  const endpoint = getCloudEndpoint();
  const official = normalize(ORG2_CLOUD_OFFICIAL_SUPABASE_URL);
  if (
    !auth ||
    !endpoint.isOfficial ||
    normalize(endpoint.supabaseUrl) !== official ||
    normalize(auth.supabaseUrl) !== official ||
    !auth.userId
  )
    return null;
  return `${official}|${auth.userId}`;
});

export function marketConnectionMatchesOwner(
  identityUserId: string,
  owner: string | null
): boolean {
  return (
    owner === `${normalize(ORG2_CLOUD_OFFICIAL_SUPABASE_URL)}|${identityUserId}`
  );
}

/** Bounded subscription for one operation; detects A→B→A as well as logout. */
export function captureMarketOwner(
  identityUserId: string,
  store: MarketStore = getInstrumentedStore(),
  onInvalidated?: () => void
) {
  const key = store.get(marketOwnerKeyAtom);
  if (!marketConnectionMatchesOwner(identityUserId, key))
    throw new Error("market_identity_mismatch");
  let invalidated = false;
  const isCurrent = () => !invalidated && store.get(marketOwnerKeyAtom) === key;
  const dispose = store.sub(marketOwnerKeyAtom, () => {
    if (!invalidated && store.get(marketOwnerKeyAtom) !== key) {
      invalidated = true;
      onInvalidated?.();
    }
  });
  return {
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) throw new Error("market_identity_mismatch");
    },
    dispose,
  };
}
