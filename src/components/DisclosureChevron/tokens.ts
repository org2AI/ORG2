/**
 * Disclosure Chevron Tokens
 *
 * Centralized class names for the chevron on a collapsible row — the ">" that
 * turns into a "v" when the row opens. CSS definitions live in
 * src/styles/_utilities.scss. Duration: 150ms per 90deg turn.
 *
 * The chevron is always ArrowRight01Icon; `expanded` rotates it rather than
 * swapping in ArrowDown01Icon, so the toggle animates.
 *
 * Usage (prefer the DisclosureChevron component, which composes these):
 * ```tsx
 * <HugeiconsIcon
 *   icon={ArrowRight01Icon}
 *   className={`${DISCLOSURE_CHEVRON_TOKENS.base} ${open ? DISCLOSURE_CHEVRON_TOKENS.expanded : ""}`}
 * />
 * ```
 */
export const DISCLOSURE_CHEVRON_TOKENS = {
  /** Always applied — owns the rotation transition */
  base: "chevron-disclosure",
  /** Applied while expanded — turns the right chevron into a down chevron */
  expanded: "chevron-disclosure-open",
} as const;
