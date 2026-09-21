import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";

import type { MobileComposerImage } from "./mobileComposerDraftStore";

export interface MobileComposerImagePreviewProps {
  images: MobileComposerImage[];
  onRemove: (id: string) => void;
}

export const MobileComposerImagePreview = memo(
  ({ images, onRemove }: MobileComposerImagePreviewProps) => {
    const { t } = useTranslation("common");
    const handleRemove = useCallback(
      (id: string) => (event: React.MouseEvent) => {
        event.stopPropagation();
        onRemove(id);
      },
      [onRemove]
    );

    if (images.length === 0) return null;

    return (
      <div
        className="flex flex-wrap gap-3 px-3 pt-2 pb-1"
        data-testid="mobile-composer-image-preview"
      >
        {images.map((image) => (
          <div
            key={image.id}
            className="group relative inline-flex h-12 w-12 shrink-0 rounded-md border border-border-2 bg-fill-1"
            data-testid="mobile-composer-image-thumbnail"
          >
            <img
              src={image.dataUrl}
              alt={image.fileName}
              className="h-full w-full rounded-md object-cover"
              draggable={false}
              loading="lazy"
              decoding="async"
            />
            <Button
              iconOnly
              shape="circle"
              variant="tertiary"
              style={{ padding: 0 }}
              onClick={handleRemove(image.id)}
              className="absolute -top-3 -right-3 min-h-11 min-w-11"
              aria-label={`${t("actions.remove")}: ${image.fileName}`}
              data-testid="mobile-composer-image-remove"
              icon={
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-3 shadow-xs">
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    data-icon="x"
                    size={10}
                    strokeWidth={2.5}
                  />
                </span>
              }
            />
          </div>
        ))}
      </div>
    );
  }
);

MobileComposerImagePreview.displayName = "MobileComposerImagePreview";
