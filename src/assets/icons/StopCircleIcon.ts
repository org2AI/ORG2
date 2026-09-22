// This barrel-backed customization needs the vendor glyph to avoid importing itself.
// eslint-disable-next-line no-restricted-imports
import StopCircleOutlineIcon from "@hugeicons/core-free-icons/StopCircleIcon";

import type { IconSvgElement } from "@src/icons";

/** Keep the outer ring outlined and fill the central stop square app-wide. */
const StopCircleIcon: IconSvgElement = StopCircleOutlineIcon.map(
  ([element, attributes]) => [
    element,
    element === "path" ? { ...attributes, fill: "currentColor" } : attributes,
  ]
);

export default StopCircleIcon;
