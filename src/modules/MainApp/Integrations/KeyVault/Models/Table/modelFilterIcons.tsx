/**
 * Provider marks for the models table's provider filter.
 *
 * A provider filter's value is a family name ("OpenAI", "Claude", "Cursor"),
 * which is a *provider*, not a model — so it resolves through the icon
 * registry's provider lookup first. That matters for Cursor, whose whole
 * family is routing-tier ids ("auto", "default"): those deliberately resolve
 * to no icon, because a tier names no model and borrowing a brand mark would
 * claim a specific model is in use. Labelling the filter is the opposite
 * case — the provider is exactly what the row means.
 *
 * Families the registry does not know by name fall back to borrowing the icon
 * of one of their own catalog models, so a provider added to `modelGrouping`
 * still shows up here with no extra wiring.
 */
import React from "react";

import ModelIcon from "@src/components/ModelIcon";
import {
  getIconProviderFromType,
  isGenericTierModelName,
} from "@src/components/ModelIcon/config";
import { getModelFamily } from "@src/util/modelGrouping";

/** One representative model id per family, taken from the loaded catalog. */
export function buildFamilyExemplars(
  modelNames: readonly string[]
): Map<string, string> {
  const exemplars = new Map<string, string>();
  for (const model of modelNames) {
    const family = getModelFamily(model);
    if (!exemplars.has(family)) exemplars.set(family, model);
  }
  return exemplars;
}

export function renderFamilyFilterIcon(
  family: string,
  exemplars: Map<string, string>
): React.ReactNode {
  const provider = getIconProviderFromType(family.toLowerCase());
  if (provider !== "unknown") {
    return <ModelIcon provider={provider} size="small" />;
  }

  const model = exemplars.get(family);
  if (!model || isGenericTierModelName(model)) return undefined;
  return <ModelIcon modelName={model} size="small" />;
}
