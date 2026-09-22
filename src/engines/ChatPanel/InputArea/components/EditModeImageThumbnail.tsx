/**
 * Edit-mode image thumbnail with overlay preview and optional remove (X).
 */
import React, { memo, useCallback, useState } from "react";

import Button from "@src/components/Button";
import { useImageActions } from "@src/components/ImageActions/useImageActions";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import ImagePreviewOverlay from "@src/scaffold/ImagePreviewOverlay";

const EditModeImageThumbnail: React.FC<{
  dataUrl: string;
  alt: string;
  onRemove?: () => void;
}> = memo(({ dataUrl, alt, onRemove }) => {
  const [showOverlay, setShowOverlay] = useState(false);
  const imageActions = useImageActions(
    { src: dataUrl, fileName: alt },
    { allowAdd: false }
  );

  const handleClick = useCallback(() => setShowOverlay(true), []);
  const handleClose = useCallback(() => setShowOverlay(false), []);
  const handleRemove = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove]
  );

  return (
    <>
      <div
        className="group relative inline-flex h-12 w-12 shrink-0 cursor-pointer rounded-md border border-border-2 bg-fill-1 transition-[border-color] duration-200 ease-in-out hover:border-border-3"
        data-testid="edit-mode-image-thumbnail"
      >
        {/* Thumbnail geometry is caller-owned; remove remains a sibling action. */}
        <Button
          layout="custom"
          className="h-full w-full rounded-[inherit]"
          onClick={handleClick}
          aria-label={alt}
          aria-busy={imageActions.busy}
          onContextMenu={imageActions.onContextMenu}
          onKeyDown={imageActions.onKeyDown}
        >
          <img
            src={dataUrl}
            alt={alt}
            className="h-full w-full rounded-[inherit] object-cover"
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        </Button>
        {onRemove && (
          <Button
            hoverTone="danger"
            size="sidebar"
            shape="circle"
            iconOnly
            onClick={handleRemove}
            className="absolute -top-1 -right-1 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`Remove ${alt}`}
            data-testid="edit-mode-image-remove"
            icon={
              <HugeiconsIcon
                icon={Cancel01Icon}
                data-icon="x"
                size={12}
                strokeWidth={2}
              />
            }
          />
        )}
      </div>
      {showOverlay && (
        <ImagePreviewOverlay
          allowAddToChat={false}
          dataUrl={dataUrl}
          onClose={handleClose}
        />
      )}
    </>
  );
});
EditModeImageThumbnail.displayName = "EditModeImageThumbnail";

export default EditModeImageThumbnail;
