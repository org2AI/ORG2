/**
 * dnd-kit modifier for WebView/Tauri environments.
 *
 * Corrects drag transform coordinates when the UI is scaled (e.g. via CSS
 * transform or zoom).
 */
import type { Modifier } from "@dnd-kit/core";

import { getUiScaleFromCssVar } from "@src/util/dom/uiScale";

/**
 * Scale-aware modifier for dnd-kit
 * Corrects drag transform coordinates when UI is scaled
 */
export const scaleAwareModifier: Modifier = ({ transform }) => {
  const scale = getUiScaleFromCssVar();

  if (scale === 1) {
    return transform;
  }

  return {
    ...transform,
    x: transform.x / scale,
    y: transform.y / scale,
  };
};
