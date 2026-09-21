/**
 * ChatImageThumbnail
 *
 * Clickable image thumbnail used by chat surfaces (main chat panel and
 * the WorkStation Communication chat) to render an attached image
 * reference. Click opens `ImagePreviewOverlay` for the full view.
 *
 * Accepts the same heterogeneous reference set Rust emits on
 * `event.result.images`:
 *   1. `data:` URL    — already a data URL, used as-is
 *   2. `asset://`     — Tauri asset protocol URL; the path is extracted
 *                       and read directly via `readFile`
 *   3. absolute path  — read directly via `readFile`
 *   4. HTTP/blob URL  — browser-managed loading, without a JS byte buffer
 */
import { readFile } from "@tauri-apps/plugin-fs";
import React, { memo, useCallback, useEffect, useState } from "react";

import { readTranscriptImage } from "@src/api/tauri/externalHistory/sources/codexApp/images";
import Button from "@src/components/Button";
import { localImagePath } from "@src/components/ImageActions/imageOperations";
import { useImageActions } from "@src/components/ImageActions/useImageActions";
import { createLogger } from "@src/hooks/logger";
import { HugeiconsIcon, Image01Icon, ImageNotFound01Icon } from "@src/icons";
import ImagePreviewOverlay from "@src/scaffold/ImagePreviewOverlay";
import {
  releaseImageUrl,
  uint8ArrayToImageUrl,
} from "@src/util/file/binaryUtils";
import {
  imageRefToRustPath,
  isDirectImageUrl,
  parseTranscriptImageRef,
} from "@src/util/file/imageRefs";
import { getImageMimeType } from "@src/util/file/previewTypes";

const log = createLogger("ChatImageThumbnail");

/**
 * Displayable URL for an image reference. A `blob:` result belongs to the
 * caller, which releases it with `releaseImageUrl`.
 */
export async function resolveImageSrc(ref: string): Promise<string> {
  if (isDirectImageUrl(ref)) return ref;

  const transcript = parseTranscriptImageRef(ref);
  if (transcript) {
    const embedded = await readTranscriptImage(transcript);
    if (embedded) return embedded;
  }
  const filePath = imageRefToRustPath(ref);

  const mimeType = getImageMimeType(filePath) ?? "image/png";
  const data = await readFile(filePath);
  return uint8ArrayToImageUrl(data, mimeType);
}

/**
 * Load an image reference for display while the caller is mounted. Browser
 * URLs pass straight through; asset/path/transcript refs are read into a URL
 * this hook owns and releases on unmount or ref change. Callers key the
 * component by ref so a new ref never shows the previous image.
 */
export function useResolvedImageSrc(imageRef: string): {
  src: string | null;
  failed: boolean;
} {
  const isDirectUrl = isDirectImageUrl(imageRef);
  const [asyncSrc, setAsyncSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isDirectUrl) return;
    let cancelled = false;
    // Object URL owned by this effect run; released on teardown.
    let objectUrl: string | null = null;
    resolveImageSrc(imageRef)
      .then((src) => {
        if (cancelled) {
          releaseImageUrl(src);
          return;
        }
        objectUrl = src;
        setAsyncSrc(src);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          log.warn("Attachment image could not be read", { imageRef, error });
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      releaseImageUrl(objectUrl);
    };
  }, [imageRef, isDirectUrl]);

  return { src: isDirectUrl ? imageRef : asyncSrc, failed };
}

interface ChatImageThumbnailProps {
  /** Image reference: data URL, asset URL, or absolute file path. */
  imageRef: string;
  /** Alt text for the thumbnail and overlay. */
  alt: string;
  /** Thumbnail size class (default `h-10 w-10`). */
  sizeClassName?: string;
  imageFit?: "cover" | "contain";
  gallery?: { src: string; fileName?: string }[];
  galleryIndex?: number;
}

export const ChatImageThumbnail: React.FC<ChatImageThumbnailProps> = memo(
  ({
    imageRef,
    alt,
    sizeClassName = "h-10 w-10",
    imageFit = "cover",
    gallery,
    galleryIndex,
  }) => {
    const [showOverlay, setShowOverlay] = useState(false);
    // Browser URLs are loaded lazily by the image element, without JS byte copies.
    // The parent keys items by ref so a ref change remounts this component,
    // which guarantees the resolved source always starts fresh.
    const { src: resolvedSrc, failed: loadFailed } =
      useResolvedImageSrc(imageRef);
    const imageActions = useImageActions({
      src: resolvedSrc ?? "",
      localPath: localImagePath(imageRef),
      fileName: gallery?.[galleryIndex ?? 0]?.fileName,
    });

    // Stop propagation so the parent chat row (which may own a click
    // handler for edit-mode in the main chat panel or jump-to-message in
    // the WorkStation chat) does not fire when the user clicks the
    // thumbnail to open the preview.
    const handleClick = useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation();
        if (resolvedSrc) setShowOverlay(true);
      },
      [resolvedSrc]
    );

    const handleClose = useCallback(() => {
      setShowOverlay(false);
    }, []);

    return (
      <>
        <Button
          layout="custom"
          disabled={!resolvedSrc}
          className={`group relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-2 bg-fill-1 text-text-3 ${resolvedSrc ? "cursor-pointer" : "cursor-default"} ${sizeClassName}`}
          onClick={handleClick}
          aria-busy={imageActions.busy}
          onContextMenu={imageActions.onContextMenu}
          onKeyDown={imageActions.onKeyDown}
          tabIndex={resolvedSrc ? 0 : -1}
          aria-label={alt}
          data-image-state={
            resolvedSrc ? "ready" : loadFailed ? "unavailable" : "loading"
          }
        >
          {resolvedSrc ? (
            <img
              src={resolvedSrc}
              alt={alt}
              className={`h-full w-full ${imageFit === "contain" ? "object-contain" : "object-cover"}`}
              draggable={false}
              loading="lazy"
              decoding="async"
            />
          ) : loadFailed ? (
            <HugeiconsIcon
              icon={ImageNotFound01Icon}
              data-icon="image-off"
              size={16}
              strokeWidth={1.5}
              aria-label={alt}
            />
          ) : (
            <HugeiconsIcon
              icon={Image01Icon}
              data-icon="image-icon"
              size={16}
              strokeWidth={1.5}
              className="animate-pulse motion-reduce:animate-none"
              aria-label={alt}
            />
          )}
        </Button>
        {showOverlay && resolvedSrc && (
          <ImagePreviewOverlay
            dataUrl={resolvedSrc}
            originalRef={imageRef}
            onClose={handleClose}
            images={gallery}
            initialIndex={galleryIndex}
            resolveImage={resolveImageSrc}
          />
        )}
      </>
    );
  }
);
ChatImageThumbnail.displayName = "ChatImageThumbnail";

interface ChatImageThumbnailRowProps {
  /** Image references (data URLs, asset URLs, or absolute paths). */
  images: string[];
  /** Alt-text prefix (`"<prefix> <n>"`). Defaults to `"Attached image"`. */
  altPrefix?: string;
  /** Thumbnail size class forwarded to each item. */
  sizeClassName?: string;
  /** Extra classes for the row container (e.g. `justify-end`). */
  className?: string;
}

/**
 * Wrap-flow row of thumbnails. Returns `null` when `images` is empty so
 * callers can render unconditionally.
 */
export const ChatImageThumbnailRow: React.FC<ChatImageThumbnailRowProps> = memo(
  ({ images, altPrefix = "Attached image", sizeClassName, className }) => {
    const gallery = React.useMemo(
      () =>
        (images ?? []).map((src) => {
          const path = imageRefToRustPath(src);
          return {
            src,
            fileName: /^(data:|blob:)/.test(path)
              ? undefined
              : path.split(/[\\/]/).pop(),
          };
        }),
      [images]
    );
    if (!images || images.length === 0) return null;
    return (
      <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
        {images.map((ref, idx) => (
          <ChatImageThumbnail
            key={`${ref}-${idx}`}
            imageRef={ref}
            alt={`${altPrefix} ${idx + 1}`}
            sizeClassName={sizeClassName}
            gallery={gallery}
            galleryIndex={idx}
          />
        ))}
      </div>
    );
  }
);
ChatImageThumbnailRow.displayName = "ChatImageThumbnailRow";
