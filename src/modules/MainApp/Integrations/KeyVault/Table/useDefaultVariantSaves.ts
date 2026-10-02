/**
 * Optimistic, debounced persistence for default-variant picks.
 *
 * A pick is one click on a pill, slider or speed toggle. Writing each click
 * would put an RPC (and a store publish) between the click and the control
 * settling, so picks render from an override map first and the write follows
 * once the burst stops. The override is dropped as soon as the stored key
 * agrees, handing rendering back to the shared key store.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { saveDefaultVariantOverrides } from "@src/hooks/keyVault/defaultVariantSaveCoordinator";

import {
  type DefaultVariantOverrides,
  defaultVariantOverridesSettled,
} from "./defaultVariantOverrides";

// Bursts are common (drag the slider, then flip Fast), so they coalesce into
// one write per key.
const VARIANT_SAVE_DEBOUNCE_MS = 300;

interface UseDefaultVariantSavesArgs {
  accounts: KeyVaultAccount[];
  /** Re-list the keys. Used only when a write fails. */
  onRefresh?: () => Promise<void>;
}

interface UseDefaultVariantSavesResult {
  /** Picks not yet reflected by the store, keyed by account id. */
  optimisticDefaultVariants: Map<string, DefaultVariantOverrides>;
  /** Record a pick and queue its debounced write. */
  updateDefaultVariant: (
    accountId: string,
    baseModel: string,
    model: string
  ) => void;
}

export function useDefaultVariantSaves({
  accounts,
  onRefresh,
}: UseDefaultVariantSavesArgs): UseDefaultVariantSavesResult {
  const [optimisticDefaultVariants, setOptimisticDefaultVariants] = useState<
    Map<string, DefaultVariantOverrides>
  >(new Map());
  const optimisticRef = useRef<Map<string, DefaultVariantOverrides>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Map<string, DefaultVariantOverrides>>(new Map());
  const mountedRef = useRef(true);

  const flushQueue = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const queued = queueRef.current;
    if (queued.size === 0) return;
    queueRef.current = new Map();
    const accountById = new Map(
      accounts.map((account) => [account.id, account])
    );
    for (const [accountId, overrides] of queued) {
      const account = accountById.get(accountId);
      if (!account) continue;
      // The shared coordinator owns optimistic state from this point onward,
      // including writes handed off while this table is unmounting.
      void saveDefaultVariantOverrides({
        id: account.id,
        agent_type: account.modelType,
        default_variant_overrides: [...overrides].map(
          ([base_model, model]) => ({ base_model, model })
        ),
      }).catch(() => {
        void onRefresh?.();
      });
    }
    // Drop only the local debounce overlay that was handed off. A newer click
    // must retain its own overlay until its next debounce flush.
    const next = new Map(optimisticRef.current);
    for (const [accountId, submitted] of queued) {
      const remaining = new Map(next.get(accountId));
      for (const [family, model] of submitted) {
        if (remaining.get(family) === model) remaining.delete(family);
      }
      if (remaining.size) next.set(accountId, remaining);
      else next.delete(accountId);
    }
    optimisticRef.current = next;
    if (mountedRef.current) setOptimisticDefaultVariants(next);
  }, [accounts, onRefresh]);

  // Keep the latest flush impl in a ref so the unmount cleanup can fire a
  // pending debounced write (e.g. a pick, then an immediate tab switch).
  const flushQueueRef = useRef(flushQueue);
  useEffect(() => {
    flushQueueRef.current = flushQueue;
  }, [flushQueue]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flushQueueRef.current();
    };
  }, []);

  const updateDefaultVariant = useCallback(
    (accountId: string, baseModel: string, model: string) => {
      // Render the pick immediately; the write follows once the clicks stop.
      const next = new Map(optimisticRef.current);
      const forAccount = new Map(next.get(accountId) ?? []);
      forAccount.set(baseModel, model);
      next.set(accountId, forAccount);
      optimisticRef.current = next;
      setOptimisticDefaultVariants(next);

      const queued =
        queueRef.current.get(accountId) ?? new Map<string, string>();
      queued.set(baseModel, model);
      queueRef.current.set(accountId, queued);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flushQueueRef.current();
      }, VARIANT_SAVE_DEBOUNCE_MS);
    },
    []
  );

  useEffect(() => {
    if (optimisticDefaultVariants.size === 0) return;
    // Drop a pick once the stored key says the same thing, so the rendered
    // account goes back to being the store's own record.
    setOptimisticDefaultVariants((prev) => {
      const next = new Map(prev);
      for (const account of accounts) {
        const overrides = next.get(account.id);
        if (!overrides) continue;
        if (
          defaultVariantOverridesSettled(account.defaultVariants, overrides)
        ) {
          next.delete(account.id);
        }
      }
      if (next.size === prev.size) return prev;
      optimisticRef.current = next;
      return next;
    });
  }, [accounts, optimisticDefaultVariants]);

  return { optimisticDefaultVariants, updateDefaultVariant };
}
