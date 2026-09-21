/**
 * SpotlightFooter Component
 *
 * Keyboard shortcut hints in a pill below the Spotlight panel. Escape is
 * not hinted: closing an overlay with it is universal.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
} from "@src/components/KeyboardShortcut";

// ============ TYPES ============

/**
 * Which chip to show when {@link SpotlightFooterProps.hasActiveAction} is true.
 *
 * - `back` — Backspace + "Back" (drill-in palettes, e.g. WorkingDirectoryPalette).
 * - `switchColumn` — Tab + "Switch column" (two-column palettes like
 *   UnifiedModelPalette, where Backspace is intentionally inert and
 *   Tab/ArrowLeft hand focus back to the left column).
 * - `switchSection` — Tab + "Switch section" for palettes with a pinned
 *   action section below the main result list.
 */
export const SPOTLIGHT_FOOTER_ACTIVE_CHIP = {
  back: "back",
  switchColumn: "switchColumn",
  switchSection: "switchSection",
} as const;
export type SpotlightFooterActiveChip =
  (typeof SPOTLIGHT_FOOTER_ACTIVE_CHIP)[keyof typeof SPOTLIGHT_FOOTER_ACTIVE_CHIP];

interface SpotlightFooterProps {
  /** Whether there's an active path (items selected) */
  hasActiveAction: boolean;
  /**
   * Which chip to render in the "active action" slot. Defaults to `back`
   * (Backspace + Return) to match historical drill-in palettes.
   */
  activeActionChip?: SpotlightFooterActiveChip;
  /**
   * Palette-owned controls rendered inside the pill after the last hint
   * (see `ShellFooterAction placement="inline"`). Keep these visually
   * quiet — the pill is a hint strip, not a toolbar.
   */
  trailingSlot?: React.ReactNode;
}

// ============ COMPONENT ============

export const SpotlightFooter: React.FC<SpotlightFooterProps> = ({
  hasActiveAction,
  activeActionChip = SPOTLIGHT_FOOTER_ACTIVE_CHIP.back,
  trailingSlot,
}) => {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-fit max-w-full overflow-hidden rounded-full border border-border-2 bg-bg-2 shadow-lg">
      {/* The pill's rounded end hugs the first key chip, matching its
          vertical inset. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-2 pr-4 pl-2 text-[11px] text-text-2">
        <span className="flex items-center gap-1.5">
          <KeyboardShortcut
            shortcutId={"spotlight_navigate"}
            variant={KEYBOARD_SHORTCUT_VARIANT.spotlightFooter}
          />
          <span>{t("selectors.spotlightFooter.navigate")}</span>
        </span>

        <span className="flex items-center gap-1.5">
          <KeyboardShortcut
            shortcutId={"spotlight_select"}
            variant={KEYBOARD_SHORTCUT_VARIANT.spotlightFooter}
          />
          <span>{t("selectors.spotlightFooter.select")}</span>
        </span>

        {hasActiveAction &&
          (activeActionChip === SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchColumn ||
          activeActionChip === SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection ? (
            <span className="flex items-center gap-1.5">
              <KeyboardShortcut
                shortcutId={"spotlight_switch_focus"}
                variant={KEYBOARD_SHORTCUT_VARIANT.spotlightFooter}
              />
              <span>
                {activeActionChip === SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection
                  ? t("selectors.spotlightFooter.switchSection")
                  : t("selectors.spotlightFooter.switchColumn")}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <KeyboardShortcut
                shortcutId={"spotlight_back"}
                variant={KEYBOARD_SHORTCUT_VARIANT.spotlightFooter}
              />
              <span>{t("actions.back")}</span>
            </span>
          ))}

        {trailingSlot}
      </div>
    </div>
  );
};
