import { parseModelVariant } from "./modelVariants";

/** Size variants such as o4-mini own an effort ladder; mini is not effort. */
export function getModelEffortBaseModel(model: string): string {
  const parsed = parseModelVariant(model);
  return parsed && (parsed.reasoning || parsed.thinking || parsed.fast)
    ? parsed.baseModel
    : model;
}

/**
 * A family id is not an extra effort rung when concrete efforts cover the
 * same thinking/speed combination. Keep bare ids for models without that
 * ladder, including speed-only and thinking-only families.
 */
export function selectableModelVariants<T extends { model: string }>(
  variants: readonly T[]
): T[] {
  const entries = variants.map((variant) => {
    const parsed = parseModelVariant(variant.model);
    return {
      variant,
      reasoning: parsed?.reasoning,
      key: JSON.stringify([
        getModelEffortBaseModel(variant.model),
        parsed?.thinking ?? false,
        parsed?.fast ?? false,
      ]),
    };
  });
  const explicitEfforts = new Set(
    entries.filter((entry) => entry.reasoning).map((entry) => entry.key)
  );
  return entries
    .filter((entry) => entry.reasoning || !explicitEfforts.has(entry.key))
    .map((entry) => entry.variant);
}
