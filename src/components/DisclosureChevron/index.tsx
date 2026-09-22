/**
 * DisclosureChevron — the collapsed/expanded affordance on trail sections,
 * sidebar group headers and tree rows.
 *
 * Renders ArrowRight01Icon in every state and rotates it 90deg when
 * `expanded`, so toggling animates instead of hard-swapping two glyphs. The
 * rotated right chevron is geometrically identical to ArrowDown01Icon, so this
 * is a motion change only.
 *
 * `data-icon` still reports the direction the chevron actually points
 * ("chevron-right" / "chevron-down"), which keeps existing selectors and tests
 * that keyed on the two-icon swap working unchanged.
 */
import { ArrowRight01Icon, HugeiconsIcon } from "@src/icons";

import { DISCLOSURE_CHEVRON_TOKENS } from "./tokens";

export interface DisclosureChevronProps {
  /** True while the section this chevron belongs to is open. */
  expanded: boolean;
  /** Icon size in px. Matches the 14px most sidebar rows use. */
  size?: number;
  strokeWidth?: number;
  /** Color/layout classes for the icon (the rotation classes are added here). */
  className?: string;
  "aria-hidden"?: boolean;
}

export default function DisclosureChevron({
  expanded,
  size = 14,
  strokeWidth,
  className,
  "aria-hidden": ariaHidden,
}: DisclosureChevronProps) {
  return (
    <HugeiconsIcon
      icon={ArrowRight01Icon}
      data-icon={expanded ? "chevron-down" : "chevron-right"}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={ariaHidden}
      className={[
        DISCLOSURE_CHEVRON_TOKENS.base,
        expanded ? DISCLOSURE_CHEVRON_TOKENS.expanded : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
