/**
 * modelSourceScope — which credential sources the palette's browse columns list.
 *
 * BYOK keys (Key Vault) and Market packages both feed the same two columns:
 * Step 1 lists models (or keys, in key-first mode) and Step 2 lists the
 * sources that can launch them. The search-row switch picks one kind or the
 * other; Pinned and Recent are deliberately left whole, so a quick pick is
 * never hidden by a browse filter.
 *
 * An absent scope narrows nothing. That is the anchored dropdown variant,
 * which carries no switch and so keeps listing every source it can reach.
 *
 * The Market scope stays selectable with no packages bought: the empty Step 1
 * column then carries the Market purchase prompt, which is the point of
 * offering the scope at all.
 *
 * See `spotlightModelSourceScopeAtom` for the persisted setting.
 */
import {
  MODEL_SOURCE_SCOPE,
  type ModelSourceScope,
} from "@src/store/ui/spotlightModelSourceScopeAtom";

export interface ScopedListingSources<TAccount, TMarketSource> {
  accounts: TAccount[];
  marketSources: TMarketSource[];
}

const EMPTY: never[] = [];

/** Narrow the browse listings to the sources the scope admits. */
export function scopeListingSources<TAccount, TMarketSource>(
  accounts: TAccount[],
  marketSources: TMarketSource[],
  scope: ModelSourceScope | undefined
): ScopedListingSources<TAccount, TMarketSource> {
  return {
    accounts: scope === MODEL_SOURCE_SCOPE.MARKET ? EMPTY : accounts,
    marketSources: scope === MODEL_SOURCE_SCOPE.KEYS ? EMPTY : marketSources,
  };
}

/** Whether Market rows (including its loading / error row) belong in the list. */
export function scopeIncludesMarket(
  scope: ModelSourceScope | undefined
): boolean {
  return scope !== MODEL_SOURCE_SCOPE.KEYS;
}
