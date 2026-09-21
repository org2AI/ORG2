import { invoke } from "@tauri-apps/api/core";

import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { withFreshMarketOwner } from "./auth";
import { type MarketStore } from "./identity";

const pending = new WeakMap<MarketStore, Promise<void>>();
const DEADLINE_MS = 30_000;

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
    // Uses the same canonical refresh, CAS persistence and native owner sync
    // as an explicit Package action. Hidden-window demand is correctness work.
    // The canonical refresh can be queued on a Web Lock or native barrier.
    // Keep at most one underlying operation per store even after our deadline;
    // later tickets fail safely until it settles, without accumulating waiters.
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
  } finally {
    // Wake native on failure too. This carries no token, identity or success
    // claim: native independently rereads and verifies canonical auth.
    await invoke("market_connection_refresh_complete", { ticket });
  }
}
