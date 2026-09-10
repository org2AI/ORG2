import React from "react";

import { DECORATIVE_ICON_CLASS } from "@src/config/appearance/decorativeIcons";
import { ExternalLinkIcon, HugeiconsIcon } from "@src/icons";

import { getDocumentApplicationIcon } from "./applicationIcons";

export default function ApplicationIcon({ path }: { path?: string }) {
  const src = getDocumentApplicationIcon(path);
  return src ? (
    <img
      src={src}
      width={16}
      height={16}
      alt=""
      aria-hidden
      className={DECORATIVE_ICON_CLASS}
    />
  ) : (
    <HugeiconsIcon
      icon={ExternalLinkIcon}
      size={16}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}
