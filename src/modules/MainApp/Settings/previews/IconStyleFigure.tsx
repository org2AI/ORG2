/**
 * Preview figure for "Icon style": real file-type and model icons in one
 * treatment. `data-icon-style-preview` pins that treatment whatever the
 * current setting is (see `src/styles/_decorative-icons.scss`).
 */
import React from "react";

import FileTypeIcon from "@src/components/FileTypeIcon";
import ModelIcon, { type IconProvider } from "@src/components/ModelIcon";

export type IconStyle = "colorful" | "monochrome";

const FILE_NAMES = [
  "app.tsx",
  "main.py",
  "index.html",
  "styles.css",
  "config.json",
] as const;
/** Brand-colored (non-themeable) marks, so the desaturation is visible. */
const PROVIDERS: readonly IconProvider[] = ["claude", "gemini", "deepseek"];

export const IconStyleFigure: React.FC<{ style: IconStyle }> = ({ style }) => (
  <div
    data-icon-style-preview={style}
    className="flex flex-col items-center gap-2 rounded-md border border-border-2 px-3 py-2.5"
  >
    <div className="flex items-center gap-2">
      {FILE_NAMES.map((fileName) => (
        <FileTypeIcon key={fileName} fileName={fileName} />
      ))}
    </div>
    <div className="flex items-center gap-2">
      {PROVIDERS.map((provider) => (
        <ModelIcon key={provider} provider={provider} size={16} />
      ))}
    </div>
  </div>
);
