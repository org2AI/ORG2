/**
 * ImageThumbnailRow
 *
 * Displays image attachment thumbnails in the session creator input.
 * Click opens fullscreen preview; X button removes the image.
 */
import React, { memo, useCallback, useState } from "react";

import Button from "@src/components/Button";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import ImagePreviewOverlay from "@src/scaffold/ImagePreviewOverlay";
import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

// ============================================
// Single Thumbnail
// ============================================

interface ThumbnailProps {
  image: ChatImageAttachment;
  onRemove: (id: string) => void;
}

const Thumbnail: React.FC<ThumbnailProps> = memo(({ image, onRemove }) => {
  const [showOverlay, setShowOverlay] = useState(false);

  const handleRemove = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onRemove(image.id);
    },
    [image.id, onRemove]
  );

  return (
    <>
      <div
        className="group relative inline-flex h-12 w-12 shrink-0 cursor-pointer rounded-md border border-border-2 bg-fill-1 transition-[border-color] duration-200 ease-in-out hover:border-border-3"
        onClick={() => setShowOverlay(true)}
        data-testid="chat-image-attachment-thumbnail"
        data-image-file-name={image.fileName}
      >
        <img
          src={image.dataUrl}
          alt={image.fileName}
          className="h-full w-full rounded-[inherit] object-cover"
          draggable={false}
          data-testid="chat-image-attachment-img"
        />
        <Button
          hoverTone="danger"
          size="sidebar"
          shape="circle"
          iconOnly
          onClick={handleRemove}
          className="absolute -top-1 -right-1 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Remove ${image.fileName}`}
          data-testid="chat-image-attachment-remove"
          icon={
            <HugeiconsIcon
              icon={Cancel01Icon}
              data-icon="x"
              size={12}
              strokeWidth={2}
            />
          }
        />
      </div>
      {showOverlay && (
        <ImagePreviewOverlay
          dataUrl={image.dataUrl}
          fileName={image.fileName}
          onClose={() => setShowOverlay(false)}
        />
      )}
    </>
  );
});

Thumbnail.displayName = "Thumbnail";

// ============================================
// Row Component
// ============================================

interface ImageThumbnailRowProps {
  images: ChatImageAttachment[];
  onRemove: (id: string) => void;
}

const ImageThumbnailRow: React.FC<ImageThumbnailRowProps> = memo(
  ({ images, onRemove }) => {
    if (images.length === 0) return null;

    return (
      <div
        className="flex flex-wrap gap-1.5 px-3 pb-0.5"
        data-testid="chat-image-attachment-preview"
        data-image-count={images.length}
      >
        {images.map((image) => (
          <Thumbnail key={image.id} image={image} onRemove={onRemove} />
        ))}
      </div>
    );
  }
);

ImageThumbnailRow.displayName = "ImageThumbnailRow";

export default ImageThumbnailRow;
