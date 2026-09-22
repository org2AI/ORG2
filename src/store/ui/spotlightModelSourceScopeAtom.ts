/**
 * Spotlight Model Source Scope Atom
 *
 * Which kind of credential the model palette's two browse columns list:
 *
 * - `keys`   (default) — BYOK: the keys added to the Key Vault.
 * - `market` — the packages bought on ORG2 Market.
 *
 * The two are exclusive — the palette's search-row switch picks one, the
 * way the composer's launch switch picks GUI or TUI. It selects the
 * Step 1 / Step 2 listings only: Pinned and Recent stay whole, so a quick
 * pick never disappears because of a browse filter (and the row for the
 * model currently in use always stays clickable).
 *
 * Persisted so the choice survives reopening the palette and restarting
 * the app, exactly like the "Key first" toggle in the footer.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const MODEL_SOURCE_SCOPE = {
  KEYS: "keys",
  MARKET: "market",
} as const;

export type ModelSourceScope =
  (typeof MODEL_SOURCE_SCOPE)[keyof typeof MODEL_SOURCE_SCOPE];

const SCOPE_VALUES: readonly string[] = Object.values(MODEL_SOURCE_SCOPE);

export function isModelSourceScope(value: unknown): value is ModelSourceScope {
  return typeof value === "string" && SCOPE_VALUES.includes(value);
}

const SPOTLIGHT_MODEL_SOURCE_SCOPE_STORAGE_KEY =
  "orgii-spotlight-model-source-scope";

const storedSpotlightModelSourceScopeAtom = atomWithStorage<unknown>(
  SPOTLIGHT_MODEL_SOURCE_SCOPE_STORAGE_KEY,
  MODEL_SOURCE_SCOPE.KEYS,
  undefined,
  { getOnInit: true }
);

export const spotlightModelSourceScopeAtom = atom(
  // Anything else in storage — including the retired "all" — reads as BYOK.
  (get): ModelSourceScope => {
    const stored = get(storedSpotlightModelSourceScopeAtom);
    return isModelSourceScope(stored) ? stored : MODEL_SOURCE_SCOPE.KEYS;
  },
  (_get, set, scope: ModelSourceScope) =>
    set(storedSpotlightModelSourceScopeAtom, scope)
);
spotlightModelSourceScopeAtom.debugLabel = "spotlightModelSourceScopeAtom";
