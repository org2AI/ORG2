/**
 * Routing tiers — model ids that name a routing decision rather than a model.
 *
 * `default`, `auto` and `premium` are the ids Cursor returns from
 * `GetUsableModels` for its server-side router, but every other agent uses the
 * same words generically: a `claude_code` account's `default` means "whatever
 * the CLI picks". A tier id therefore carries neither a brand nor a product
 * name on its own — both the icon and the label may only be resolved with an
 * agent hint saying who owns it.
 *
 * Single source of truth for the tier-name set. `modelGrouping` (group labels),
 * `formatModelName` (display labels) and `ModelIcon` (brand marks) all read it
 * from here rather than keeping their own copies.
 */

/** Model ids that name a routing tier instead of a model. */
const TIER_MODEL_NAMES = new Set(["auto", "default", "premium"]);

/**
 * True for model ids that name a routing tier rather than a model. Such a name
 * carries no brand, so callers must not fall back to the agent's mark for it —
 * that would claim the session runs a specific model.
 */
export function isTierModelName(modelName: string): boolean {
  return TIER_MODEL_NAMES.has(modelName.toLowerCase());
}

/**
 * True when an agent-type hint identifies Cursor. Accepts both the key-vault
 * model type (`cursor_cli`) and the bare provider name (`cursor`) the Rust
 * provider and the validate dispatch use.
 */
function isCursorAgentHint(agentType?: string): boolean {
  return agentType === "cursor_cli" || agentType === "cursor";
}

/**
 * Display labels for Cursor's routing tiers.
 *
 * `default` is Cursor's agent-mode auto-router — the server picks a
 * composer-class model per the account's subscription (see
 * `cursor_native::provider::DEFAULT_MODEL`). Rendering the raw id read as a UI
 * state rather than a choice, and stacked badly against the variant line
 * ("only has a default version of default"), so it is named for what it does
 * and who decides.
 *
 * Deliberately untranslated, like every other model label: `formatModelName`
 * is a translation-free util, and these read as product terms rather than
 * prose.
 */
const CURSOR_TIER_LABELS: Record<string, string> = {
  default: "Auto (Cursor picks)",
  auto: "Auto",
  premium: "Premium",
};

/**
 * Display label for a routing-tier model id, or `undefined` when the id is not
 * a tier or the owner is not known to be Cursor.
 *
 * Returning `undefined` rather than a generic fallback keeps every non-Cursor
 * caller on its existing formatting: only Cursor's tiers have a product meaning
 * worth naming.
 */
export function formatTierModelLabel(
  modelName: string,
  agentType?: string
): string | undefined {
  if (!isCursorAgentHint(agentType)) return undefined;
  return CURSOR_TIER_LABELS[modelName.toLowerCase()];
}
