import type { ReactNode } from "react";

import {
  type SecondaryPanelConfig,
  type SecondaryPanelPosition,
  buildSecondaryPanelConfig,
} from "../../shared/WorkStationShell/config";

/** DevTools size bounds along each axis: width when right, height when bottom. */
const BROWSER_DEVTOOLS_SIZE_BOUNDS = {
  right: { minSize: 200, maxSize: 400 },
  bottom: { minSize: 160, maxSize: 600 },
} as const satisfies Record<
  SecondaryPanelPosition,
  { minSize: number; maxSize: number }
>;

/**
 * Secondary-panel config for the Browser DevTools panel. The panel mounts
 * once and CSS relocates it; size, resize handler and bounds follow the
 * active axis (width for right, height for bottom).
 */
export function buildBrowserDevToolsPanelConfig(options: {
  content: ReactNode;
  position: SecondaryPanelPosition;
  collapsed: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  height: number;
  onHeightChange: (height: number) => void;
  onClose: () => void;
}): SecondaryPanelConfig {
  const isRight = options.position === "right";
  return buildSecondaryPanelConfig({
    content: options.content,
    position: options.position,
    collapsed: options.collapsed,
    size: isRight ? options.width : options.height,
    onSizeChange: isRight ? options.onWidthChange : options.onHeightChange,
    onClose: options.onClose,
    ...BROWSER_DEVTOOLS_SIZE_BOUNDS[options.position],
  });
}
