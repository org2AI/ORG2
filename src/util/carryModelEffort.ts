import { parseModelVariant } from "@src/util/modelVariants";

/**
 * Resolve the variant of `nextModelId` that keeps the effort of
 * `currentModelId`, choosing only among `candidateModelIds` (the ids the
 * chosen key actually exposes).
 *
 * Matches on reasoning level, fast and thinking first, then relaxes thinking
 * and fast in turn. Returns `nextModelId` unchanged when the current model
 * carries no effort or the next model's family has no variant at that level.
 */
export function carryModelEffort(
  currentModelId: string | null | undefined,
  nextModelId: string,
  candidateModelIds: readonly string[]
): string {
  const current = currentModelId ? parseModelVariant(currentModelId) : null;
  if (!current?.reasoning) return nextModelId;

  const nextBase = parseModelVariant(nextModelId)?.baseModel ?? nextModelId;
  const family = [nextModelId, ...candidateModelIds]
    .map(parseModelVariant)
    .filter(
      (variant) =>
        variant?.baseModel === nextBase &&
        variant.reasoning === current.reasoning
    );

  const match =
    family.find(
      (variant) =>
        variant?.fast === current.fast && variant.thinking === current.thinking
    ) ??
    family.find((variant) => variant?.fast === current.fast) ??
    family[0];
  return match?.model ?? nextModelId;
}
