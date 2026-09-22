/**
 * dnd-kit sensors for WebView/Tauri environments.
 *
 * Provides sensors that work correctly when the UI is scaled (e.g. via CSS
 * transform or zoom).
 */
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { getUiScaleFromCssVar } from "@src/util/dom/uiScale";

/**
 * Options for useWebViewSensors hook
 */
export interface UseWebViewSensorsOptions {
  /** Distance in pixels before drag activates (default: 8) */
  activationDistance?: number;
  /** Whether to enable keyboard sensor (default: true) */
  enableKeyboard?: boolean;
}

/**
 * Custom sensors optimized for WebView/Tauri environments
 * Provides better drag behavior in scaled UIs
 */
export function useWebViewSensors(options: UseWebViewSensorsOptions = {}) {
  const { activationDistance = 8, enableKeyboard = true } = options;

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: activationDistance,
    },
  });

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: (event, args) => {
      const scale = getUiScaleFromCssVar();
      const { currentCoordinates } = args;
      const step = 10 / scale;

      switch (event.code) {
        case "ArrowUp":
          return { ...currentCoordinates, y: currentCoordinates.y - step };
        case "ArrowDown":
          return { ...currentCoordinates, y: currentCoordinates.y + step };
        case "ArrowLeft":
          return { ...currentCoordinates, x: currentCoordinates.x - step };
        case "ArrowRight":
          return { ...currentCoordinates, x: currentCoordinates.x + step };
        default:
          return currentCoordinates;
      }
    },
  });

  const sensors = useSensors(
    pointerSensor,
    ...(enableKeyboard ? [keyboardSensor] : [])
  );

  return sensors;
}
