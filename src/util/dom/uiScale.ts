/**
 * UI scale read from the `--ui-scale` CSS variable.
 *
 * Pointer geometry (drag transforms, terminal hit-testing, editor selection
 * rects) has to be divided by the scale the shell applied, so every consumer
 * reads the same variable through this helper.
 */

/**
 * Gets the current UI scale from CSS variable
 * Falls back to 1 if not set
 */
export function getUiScaleFromCssVar(): number {
  if (typeof window === "undefined") return 1;

  const root = document.documentElement;
  const scaleValue = getComputedStyle(root).getPropertyValue("--ui-scale");

  if (!scaleValue || scaleValue.trim() === "") {
    return 1;
  }

  const parsed = parseFloat(scaleValue);
  return isNaN(parsed) ? 1 : parsed;
}
