/**
 * ImageAttachmentPreview
 *
 * Displays pasted/dropped image thumbnails above the chat input.
 * Click opens fullscreen preview overlay with copy/download/close.
 */
import { useAtom } from "jotai";
import React, { memo, useCallback, useState } from "react";

import Button from "@src/components/Button";
import { useImageActions } from "@src/components/ImageActions/useImageActions";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import ImagePreviewOverlay from "@src/scaffold/ImagePreviewOverlay";
import {
  type ChatImageAttachment,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";

// ============================================
// Single Image Thumbnail
// ============================================

interface ImageThumbnailProps {
  image: ChatImageAttachment;
  onRemove: (id: string) => void;
}

const ImageThumbnail: React.FC<ImageThumbnailProps> = memo(
  ({ image, onRemove }) => {
    const [showOverlay, setShowOverlay] = useState(false);
    const imageActions = useImageActions(
      {
        src: image.dataUrl,
        fileName: image.fileName,
        localPath: image.localPath,
      },
      { allowAdd: false }
    );

    const handleRemove = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onRemove(image.id);
      },
      [image.id, onRemove]
    );

    const handleClick = useCallback(() => {
      setShowOverlay(true);
    }, []);

    const handleCloseOverlay = useCallback(() => {
      setShowOverlay(false);
    }, []);

    return (
      <>
        <div
          className="group relative inline-flex h-12 w-12 shrink-0 cursor-pointer rounded-md border border-border-2 bg-fill-1 transition-[border-color] duration-200 ease-in-out hover:border-border-3"
          data-testid="chat-image-attachment-thumbnail"
          data-image-file-name={image.fileName}
        >
          {/* Thumbnail geometry is caller-owned; remove remains a sibling action. */}
          <Button
            layout="custom"
            className="h-full w-full rounded-[inherit]"
            onClick={handleClick}
            aria-label={image.fileName}
            aria-busy={imageActions.busy}
            onContextMenu={imageActions.onContextMenu}
            onKeyDown={imageActions.onKeyDown}
          >
            <img
              src={image.dataUrl}
              alt={image.fileName}
              className="h-full w-full rounded-[inherit] object-cover"
              draggable={false}
              loading="lazy"
              decoding="async"
              data-testid="chat-image-attachment-img"
            />
          </Button>
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
            allowAddToChat={false}
            dataUrl={image.dataUrl}
            originalRef={image.localPath}
            fileName={image.fileName}
            onClose={handleCloseOverlay}
          />
        )}
      </>
    );
  }
);

ImageThumbnail.displayName = "ImageThumbnail";

// ============================================
// Main Component
// ============================================

interface ImageAttachmentPreviewProps {
  ownerId?: string;
  className?: string;
}

const ImageAttachmentPreview: React.FC<ImageAttachmentPreviewProps> = memo(
  ({ ownerId, className = "px-3 pb-0.5" }) => {
    const [images, setImages] = useAtom(chatImageAttachmentsAtom);
    const visibleImages = ownerId
      ? images.filter((image) => image.ownerId === ownerId)
      : images.filter((image) => !image.ownerId);

    const handleRemove = useCallback(
      (id: string) => {
        setImages((prev) => prev.filter((img) => img.id !== id));
      },
      [setImages]
    );

    if (visibleImages.length === 0) return null;

    return (
      <div
        className={`flex flex-wrap gap-1.5 ${className}`}
        data-testid="chat-image-attachment-preview"
        data-image-count={visibleImages.length}
      >
        {visibleImages.map((image) => (
          <ImageThumbnail
            key={image.id}
            image={image}
            onRemove={handleRemove}
          />
        ))}
      </div>
    );
  }
);

ImageAttachmentPreview.displayName = "ImageAttachmentPreview";

export default ImageAttachmentPreview;
