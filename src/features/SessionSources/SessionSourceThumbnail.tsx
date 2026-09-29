/**
 * SessionSourceThumbnail — the lazy image shared by source summaries and rows.
 *
 * The bytes are read only while the row is mounted and released with it, so
 * a folded Sources section or an inactive full view holds no image data.
 */
import { memo } from "react";

import { useResolvedImageSrc } from "@src/engines/ChatPanel/ChatImageThumbnail";
import { HugeiconsIcon, Image01Icon, ImageNotFound01Icon } from "@src/icons";

export const SessionSourceThumbnail = memo(function SessionSourceThumbnail({
  imageRef,
  size,
}: {
  imageRef: string;
  size: number;
}) {
  const { src, failed } = useResolvedImageSrc(imageRef);

  if (!src) {
    return (
      <HugeiconsIcon
        icon={failed ? ImageNotFound01Icon : Image01Icon}
        data-icon={failed ? "image-off" : "image-icon"}
        aria-hidden
        size={size}
        strokeWidth={1.75}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      className="shrink-0 rounded-[3px] object-cover ring-1 ring-border-2"
      style={{ width: size, height: size }}
    />
  );
});
