/**
 * ModelIcon Configuration
 *
 * Unified icon system for all AI model providers and agents.
 *
 * This is the single source of truth for icon lookups. It supports:
 * - `ModelType` (business logic) → icon lookup via `getIconProvider()`
 * - `IconProvider` (UI layer) → direct icon lookup
 * - Model name string → icon inference via `getIconProviderFromModelName()`
 *
 * The registries live in sibling modules, so a new model or provider usually
 * touches one small file:
 * - `iconProviders.ts`: `IconProvider` union, glyph imports, `ICON_MAP`, picker
 *   lists and `THEMEABLE_ICONS`
 * - `modelTypeIcons.ts`: `ModelType` → `IconProvider`
 * - `modelNameIcons.ts`: model-name inference rules (first match wins)
 * - `urlIconComponent.ts`: adapts URL glyphs to the svgr component shape
 */
import type { FC, SVGProps } from "react";

import type { ModelType } from "@src/api/types/keys";

import { ICON_MAP, type IconProvider } from "./iconProviders";
import { MODEL_TYPE_TO_ICON } from "./modelTypeIcons";
import { toIconComponent } from "./urlIconComponent";

export type { IconProvider, ModelIconSource } from "./iconProviders";
export {
  ICON_MAP,
  SELECTABLE_ICON_PROVIDERS,
  MODEL_PROVIDER_ICON_PROVIDERS,
  THEMEABLE_ICONS,
} from "./iconProviders";
export {
  getIconProviderFromModelName,
  isGenericTierModelName,
} from "./modelNameIcons";
export { toIconComponent } from "./urlIconComponent";

/**
 * Get icon provider from ModelType.
 * @param modelType - The business-logic model type (e.g. "cursor_cli", "anthropic_api")
 */
export function getIconProvider(modelType: ModelType): IconProvider {
  return MODEL_TYPE_TO_ICON[modelType] || "unknown";
}

export function getIconProviderFromType(value: string): IconProvider {
  if (isIconProvider(value)) return value;
  return MODEL_TYPE_TO_ICON[value as ModelType] || "unknown";
}

export function isIconProvider(value: string): value is IconProvider {
  return Object.prototype.hasOwnProperty.call(ICON_MAP, value);
}

export function getIconComponent(
  provider: IconProvider
): FC<SVGProps<SVGSVGElement>> | undefined {
  const source = ICON_MAP[provider];
  return source === undefined ? undefined : toIconComponent(source);
}
