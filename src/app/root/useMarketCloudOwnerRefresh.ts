import { invoke, isTauri } from "@tauri-apps/api/core";
import { useStore } from "jotai";
import { useEffect } from "react";

import {
  handleMarketOwnerRefresh,
  installMarketOwnerRecovery,
} from "@src/features/MarketConnect/ownerRefresh";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { isMainAppWindow } from "@src/util/platform/tauri/windowIdentity";

/** Demand and focus/online recovery share canonical auth; no polling. */
export function useMarketCloudOwnerRefresh(): void {
  const store = useStore();
  const enabled = isTauri() && isMainAppWindow();
  useEffect(() => {
    if (enabled) return installMarketOwnerRecovery(store);
  }, [enabled, store]);
  const handle = (ticket: unknown) => {
    void handleMarketOwnerRefresh(ticket, store).catch(() => {});
  };
  useTauriListen<unknown>("market-cloud-owner-refresh-needed", handle, {
    enabled,
    onReady: () => {
      // Recover an event emitted while the cold-start listener was mounting.
      // One read per registration; no polling or retained pending-ticket map.
      void invoke<string | null>("market_connection_refresh_pending")
        .then(handle)
        .catch(() => {});
    },
  });
}
