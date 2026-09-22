import { invoke } from "@tauri-apps/api/core";

import { synchronizeSharedServiceAuthStorage } from "@src/api/http/auth/sharedAuthStorage";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { withFreshMarketOwner } from "./auth";
import { type MarketStore, captureMarketOwner } from "./identity";

const pending = new WeakMap<MarketStore, Promise<void>>();
const DEADLINE_MS = 30_000;

// One retained, owner-bound recovery demand; no timer or periodic retry.
const recovery = new WeakMap<MarketStore, () => void>();

async function refresh(user: string, store: MarketStore): Promise<void> {
  if (pending.has(store)) return;
  const controller = new AbortController();
  const work = withFreshMarketOwner(
    async () => {},
    user,
    store,
    controller.signal
  );
  pending.set(store, work);
  const settled = () => {
    if (pending.get(store) === work) pending.delete(store);
  };
  void work.then(settled, settled);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("market_cloud_refresh_unavailable"));
        }, DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Native owns one pending ticket; duplicate events cannot claim it twice. */
export async function handleMarketOwnerRefresh(
  ticket: unknown,
  store: MarketStore = getInstrumentedStore()
): Promise<void> {
  if (typeof ticket !== "string" || !/^[0-9a-f-]{36}$/.test(ticket)) return;
  const user = await invoke<string | null>("market_connection_refresh_claim", {
    ticket,
  });
  if (!user) return;
  try {
    if (pending.has(store)) return;
    recovery.get(store)?.();
    // Retain the original generation across failure; A→B→A cannot revive it.
    const target = typeof window === "undefined" ? undefined : window;
    let disposed = false;
    let owner: ReturnType<typeof captureMarketOwner> | undefined;
    const dispose = () => {
      disposed = true;
      target?.removeEventListener("focus", retry);
      target?.removeEventListener("online", retry);
      owner?.dispose();
      if (recovery.get(store) === dispose) recovery.delete(store);
    };
    const retry = () => {
      if (disposed || !owner?.isCurrent() || pending.has(store)) return;
      void refresh(user, store).then(dispose, () => {
        if (!owner?.isCurrent()) dispose();
      });
    };
    if (target) {
      owner = captureMarketOwner(user, store, dispose);
      recovery.set(store, dispose);
    }
    try {
      await refresh(user, store);
      dispose();
    } catch (error) {
      if (owner?.isCurrent() && !disposed) {
        target?.addEventListener("focus", retry);
        target?.addEventListener("online", retry);
      } else dispose();
      throw error;
    }
  } finally {
    // Native independently rereads and verifies canonical persisted auth.
    await invoke("market_connection_refresh_complete", { ticket });
  }
}

/** Main-window lifecycle recovery, never an interval or a new auth authority. */
export function installMarketOwnerRecovery(store: MarketStore): () => void {
  let disposed = false;
  let running = false;
  let cancelCapture: (() => void) | undefined;
  const recover = async () => {
    if (disposed || running) return;
    const auth = store.get(org2CloudAuthAtom);
    if (!auth) return;
    let owner: ReturnType<typeof captureMarketOwner>;
    try {
      owner = captureMarketOwner(auth.userId, store);
    } catch {
      return;
    }
    cancelCapture = owner.dispose;
    running = true;
    try {
      // Hydration can revoke the expired native lease before its timer wakes.
      // Hold the original owner generation across this asynchronous boundary.
      await synchronizeSharedServiceAuthStorage();
      if (disposed || !owner.isCurrent()) return;
      const current = store.get(org2CloudAuthAtom);
      if (current && current.expiresAt <= Date.now() / 1000) {
        await refresh(auth.userId, store);
      }
    } catch {
      // Offline: next actual focus/online event is the only retry source.
    } finally {
      owner.dispose();
      cancelCapture = undefined;
      running = false;
    }
  };
  const onWake = () => {
    void recover().catch(() => {});
  };
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  return () => {
    disposed = true;
    cancelCapture?.();
    recovery.get(store)?.();
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
  };
}
