import { awaitNativeCloudOwnerReady } from "@src/api/http/auth/sharedAuthStorage";
import { refreshOrg2CloudAuthForAction } from "@src/features/Org2Cloud/org2CloudAuthAction";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { type MarketStore, captureMarketOwner } from "./identity";

const refreshes = new WeakMap<
  MarketStore,
  { auth: Org2CloudAuthState; ready: Promise<void> }
>();

async function refreshOwner(store: MarketStore, auth: Org2CloudAuthState) {
  const existing = refreshes.get(store);
  if (existing?.auth === auth) return existing.ready;
  const ready = (async () => {
    const result = await refreshOrg2CloudAuthForAction(auth, (update) => {
      store.set(org2CloudAuthAtom, update);
    });
    if (result.status !== "ready") {
      throw new Error(
        result.status === "expired"
          ? "market_cloud_sign_in_required"
          : result.status === "superseded"
            ? "market_identity_changed"
            : "market_cloud_verification_unavailable"
      );
    }
    // Auth writes mirror to the canonical native store asynchronously. Do not
    // let a refreshed frontend token race the native owner's expiry check.
    await awaitNativeCloudOwnerReady();
  })();
  const flight = { auth, ready };
  refreshes.set(store, flight);
  try {
    await ready;
  } finally {
    if (refreshes.get(store) === flight) refreshes.delete(store);
  }
}

/** Refresh on explicit Market work, with no background timer or expiry bypass. */
export async function withFreshMarketOwner<T>(
  work: () => Promise<T>,
  identityUserId?: string,
  store: MarketStore = getInstrumentedStore(),
  signal?: AbortSignal
): Promise<T> {
  const auth = store.get(org2CloudAuthAtom);
  if (!auth) throw new Error("market_cloud_sign_in_required");
  const owner = captureMarketOwner(identityUserId ?? auth.userId, store);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    owner.dispose();
  };
  const assertCurrent = () => {
    if (signal?.aborted) throw new Error("market_cloud_refresh_unavailable");
    owner.assertCurrent();
  };
  // A demand bridge deadline must release this subscription immediately even
  // when the shared canonical refresh is waiting on another window's Web Lock.
  signal?.addEventListener("abort", dispose, { once: true });
  try {
    // Mounting the owner subscription can rehydrate atomWithStorage into a
    // new object. Capture the refresh CAS reference after that subscription.
    const current = store.get(org2CloudAuthAtom);
    if (!current) throw new Error("market_cloud_sign_in_required");
    assertCurrent();
    await refreshOwner(store, current);
    assertCurrent();
    const result = await work();
    assertCurrent();
    return result;
  } finally {
    dispose();
  }
}
