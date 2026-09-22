import React, { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { HugeiconsIcon, Image01Icon, ImageNotFound01Icon } from "@src/icons";

import { ChatImageThumbnail, useResolvedImageSrc } from "../ChatImageThumbnail";

const GalleryChoice = memo(function GalleryChoice({
  image,
  label,
  selected,
  onSelect,
}: {
  image: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { src, failed } = useResolvedImageSrc(image);
  return (
    // A selectable image card needs caller-owned square geometry and surface.
    <Button
      layout="custom"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={`aspect-square w-full shrink-0 overflow-hidden rounded-lg border bg-bg-2 p-1 transition-[border-color,box-shadow] duration-150 focus-visible:border-primary-6 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)] focus-visible:outline-none ${selected ? "border-primary-6 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)]" : "border-border-2 hover:border-border-3"}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <HugeiconsIcon
          icon={failed ? ImageNotFound01Icon : Image01Icon}
          size={20}
          className="mx-auto text-text-3"
        />
      )}
    </Button>
  );
});

/** One full image and a thumbnail rail, outside the turn's collapsible work. */
const OutputImageGallery = memo(function OutputImageGallery({
  images,
}: {
  images: string[];
}) {
  const { t } = useTranslation("common");
  const [requestedIndex, setRequestedIndex] = useState(0);
  const selectedIndex = Math.min(
    requestedIndex,
    Math.max(0, images.length - 1)
  );
  const selected = images[selectedIndex];
  const gallery = useMemo(() => images.map((src) => ({ src })), [images]);
  if (!selected) return null;
  const label = t("imagePreview.dialogLabel");
  return (
    <section
      aria-label={label}
      data-testid="output-image-gallery"
      className="my-3 flex h-80 w-full max-w-sm min-w-0 items-start gap-2"
    >
      {images.length > 1 && (
        <div
          data-testid="output-image-thumbnails"
          className="flex max-h-full w-12 shrink-0 flex-col gap-2 overflow-y-auto p-1"
        >
          {images.map((image, index) => (
            <GalleryChoice
              key={image}
              image={image}
              label={`${label} ${index + 1}`}
              selected={index === selectedIndex}
              onSelect={() => setRequestedIndex(index)}
            />
          ))}
        </div>
      )}
      <div className="h-full min-w-0 flex-1">
        <ChatImageThumbnail
          key={selected}
          imageRef={selected}
          alt={`${label} ${selectedIndex + 1}`}
          sizeClassName="h-full w-full"
          imageFit="contain"
          gallery={gallery}
          galleryIndex={selectedIndex}
        />
      </div>
    </section>
  );
});

export default OutputImageGallery;
