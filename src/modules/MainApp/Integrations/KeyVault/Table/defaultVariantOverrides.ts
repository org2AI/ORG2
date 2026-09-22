/**
 * Pending default-variant edits, held in the UI while their write is debounced.
 *
 * A variant pick is a per-click edit of one `base_model` on one key. Saving
 * each click would put an RPC (and a store publish) between the click and the
 * control settling on its new value, so the picks are applied to the rendered
 * account first and written once the burst stops.
 */
import type { DefaultVariantInfo } from "@src/api/types/keys";

/** `base_model` → chosen variant `model`, for one account. */
export type DefaultVariantOverrides = Map<string, string>;

/** The stored list with every override applied, preserving stored order. */
export function applyDefaultVariantOverrides(
  stored: readonly DefaultVariantInfo[] | undefined,
  overrides: DefaultVariantOverrides
): DefaultVariantInfo[] {
  const next = (stored ?? []).map((variant) =>
    overrides.has(variant.base_model)
      ? {
          base_model: variant.base_model,
          model: overrides.get(variant.base_model)!,
        }
      : variant
  );
  const covered = new Set(next.map((variant) => variant.base_model));
  for (const [baseModel, model] of overrides) {
    if (covered.has(baseModel)) continue;
    next.push({ base_model: baseModel, model });
  }
  return next;
}

/** `true` once the stored list already says what every override wanted. */
export function defaultVariantOverridesSettled(
  stored: readonly DefaultVariantInfo[] | undefined,
  overrides: DefaultVariantOverrides
): boolean {
  const storedByBaseModel = new Map(
    (stored ?? []).map((variant) => [variant.base_model, variant.model])
  );
  for (const [baseModel, model] of overrides) {
    if (storedByBaseModel.get(baseModel) !== model) return false;
  }
  return true;
}
