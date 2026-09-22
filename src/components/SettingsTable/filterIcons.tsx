/**
 * Marks for `selectFilters` dropdown rows.
 *
 * These render inside the dropdown only — the closed trigger stays a plain
 * label — and they take no colour of their own, so a selected row tints the
 * mark primary-6 along with its label.
 */
import React from "react";

import { HugeiconsIcon, Layers01Icon } from "@src/icons";

/**
 * The unfiltered ("All …") row. Only worth rendering when the other rows in
 * that dropdown carry marks, otherwise the list reads ragged with it.
 *
 * `size` matches whatever the sibling rows use — brand artwork is usually 16,
 * glyphs 14.
 */
export function renderAllFilterIcon(size = 14): React.ReactNode {
  return <HugeiconsIcon icon={Layers01Icon} data-icon="layers" size={size} />;
}
