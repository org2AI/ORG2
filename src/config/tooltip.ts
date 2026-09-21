/**
 * Hover dwell options for button tooltips — the label (and shortcut) a
 * toolbar/icon button reveals on hover. Info-icon tooltips keep their own
 * timing; this token only governs `<Tooltip kind="button">`.
 */
export const BUTTON_TOOLTIP_DELAY_OPTIONS_MS = [
  0, 250, 500, 750, 1000,
] as const;

export type ButtonTooltipDelayMs =
  (typeof BUTTON_TOOLTIP_DELAY_OPTIONS_MS)[number];

/** Global default for `general.buttonTooltipDelayMs`. */
export const DEFAULT_BUTTON_TOOLTIP_DELAY_MS: ButtonTooltipDelayMs = 500;
