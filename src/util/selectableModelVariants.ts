import {
  type ResolvedModelVariantFields,
  parseModelVariant,
  resolveModelVariantFields,
} from "./modelVariants";

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
export function selectableModelVariants<
  T extends {
    model: string;
    base_model?: string;
    reasoning?: string | null;
    fast?: boolean;
    thinking?: boolean;
  },
>(variants: readonly T[]): T[] {
  const entries = variants.map((variant) => {
    const metadata =
      variant.base_model !== undefined && variant.fast !== undefined
        ? (variant as ResolvedModelVariantFields)
        : undefined;
    const resolved = resolveModelVariantFields(variant.model, metadata);
    return {
      variant,
      reasoning: resolved.reasoning,
      key: JSON.stringify([
        metadata?.base_model ?? getModelEffortBaseModel(variant.model),
        resolved.thinking ?? false,
        resolved.fast,
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
