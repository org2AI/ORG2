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

import { saveKey } from "@src/api/services/keyValidation";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { upsertSharedLocalKey } from "@src/hooks/keyVault/sharedLocalKeyStore";

import {
  type DefaultVariantOverrides,
  applyDefaultVariantOverrides,
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
  const queueRef = useRef<Set<string>>(new Set());

  const flushQueue = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const queued = [...queueRef.current];
    if (queued.length === 0) return;
    queueRef.current = new Set();

    const accountById = new Map(
      accounts.map((account) => [account.id, account])
    );
    void Promise.all(
      queued.map((accountId) => {
        const account = accountById.get(accountId);
        const overrides = optimisticRef.current.get(accountId);
        if (!account || !overrides) return Promise.resolve(undefined);
        return saveKey({
          id: account.id,
          agent_type: account.modelType,
          default_variants: applyDefaultVariantOverrides(
            account.defaultVariants,
            overrides
          ),
        });
      })
    )
      // `saveKey` answers with the stored record, so publishing it settles the
      // override. Re-listing every key would tell us nothing new.
      .then((savedKeys) => {
        for (const saved of savedKeys) {
          if (saved) upsertSharedLocalKey(saved);
        }
      })
      .catch(() => {
        const empty = new Map<string, DefaultVariantOverrides>();
        optimisticRef.current = empty;
        setOptimisticDefaultVariants(empty);
        // The write failed, so the store is the only trustworthy source left.
        void onRefresh?.();
      });
  }, [accounts, onRefresh]);

  // Keep the latest flush impl in a ref so the unmount cleanup can fire a
  // pending debounced write (e.g. a pick, then an immediate tab switch).
  const flushQueueRef = useRef(flushQueue);
  useEffect(() => {
    flushQueueRef.current = flushQueue;
  }, [flushQueue]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flushQueueRef.current();
    },
    []
  );

  const updateDefaultVariant = useCallback(
    (accountId: string, baseModel: string, model: string) => {
      // Render the pick immediately; the write follows once the clicks stop.
      const next = new Map(optimisticRef.current);
      const forAccount = new Map(next.get(accountId) ?? []);
      forAccount.set(baseModel, model);
      next.set(accountId, forAccount);
      optimisticRef.current = next;
      setOptimisticDefaultVariants(next);

      queueRef.current.add(accountId);
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
