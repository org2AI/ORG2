/**
 * SessionSourceImagePreview — the chat's image viewer, opened from a
 * Sources row with every image of the session as its gallery.
 *
 * The opened image is read here rather than borrowed from the row's
 * thumbnail: the row can unmount (a submenu or compact menu closes on click)
 * while the viewer is still showing it.
 */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import {
  resolveImageSrc,
  useResolvedImageSrc,
} from "@src/engines/ChatPanel/ChatImageThumbnail";
import ImagePreviewOverlay from "@src/scaffold/ImagePreviewOverlay";

export interface SessionSourceImage {
  ref: string;
  fileName: string | null;
}

export function SessionSourceImagePreview({
  images,
  index,
  onClose,
}: {
  images: readonly SessionSourceImage[];
  index: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { src, failed } = useResolvedImageSrc(images[index].ref);
  const gallery = useMemo(
    () =>
      images.map((image) => ({
        src: image.ref,
        fileName: image.fileName ?? undefined,
      })),
    [images]
  );

  useEffect(() => {
    if (failed) {
      Message.error(t("common:git.rail.sourceImageUnavailable"));
      onClose();
    }
  }, [failed, onClose, t]);

  if (!src) return null;
  return (
    <ImagePreviewOverlay
      dataUrl={src}
      images={gallery}
      initialIndex={index}
      resolveImage={resolveImageSrc}
      onClose={onClose}
    />
  );
}
