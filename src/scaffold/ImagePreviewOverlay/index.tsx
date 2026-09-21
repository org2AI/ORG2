/**
 * ImagePreviewOverlay
 *
 * Shared modal image viewer with separate header actions and gallery footer.
 * The modal owns focus, Escape, backdrop dismissal and overlay layering.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { localImagePath } from "@src/components/ImageActions/imageOperations";
import { useImageActions } from "@src/components/ImageActions/useImageActions";
import Slider from "@src/components/Slider";
import { PANEL_HEADER_TOKENS } from "@src/components/layout/blocks/PanelHeader";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  HugeiconsIcon,
  MinusSignIcon,
} from "@src/icons";
import Modal from "@src/scaffold/ModalSystem";
import { releaseImageUrl } from "@src/util/file/binaryUtils";

import { useImagePinchZoom } from "./useImagePinchZoom";

// ============================================
// Types
// ============================================

interface ImagePreviewOverlayProps {
  dataUrl: string;
  originalRef?: string;
  allowAddToChat?: boolean;
  /** Same-message attachments; only the selected image is resolved. */
  images?: { src: string; fileName?: string }[];
  initialIndex?: number;
  resolveImage?: (ref: string) => Promise<string>;
  fileName?: string;
  onClose: () => void;
  /** When false, hides the copy-to-clipboard control. Default true. */
  showCopyButton?: boolean;
}

// ============================================
// Component
// ============================================

const PreviewAction = ({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: typeof Copy01Icon;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Button
    {...PANEL_HEADER_TOKENS.actionButton}
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    icon={
      <HugeiconsIcon
        icon={icon}
        size={PANEL_HEADER_TOKENS.buttonIconSize}
        strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
      />
    }
  />
);

const ImagePreviewOverlay: React.FC<ImagePreviewOverlayProps> = memo(
  ({
    dataUrl,
    originalRef,
    allowAddToChat = true,
    fileName,
    onClose,
    showCopyButton = true,
    images,
    initialIndex = 0,
    resolveImage,
  }) => {
    const { t } = useTranslation("common");
    const imageRef = useRef<HTMLImageElement>(null);

    const viewportRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(100);
    const [index, setIndex] = useState(initialIndex);
    const [loaded, setLoaded] = useState<{
      index: number;
      original: string;
      src: string;
      failed?: boolean;
    } | null>(null);
    const currentSrc =
      index === initialIndex
        ? dataUrl
        : loaded?.index === index && loaded.original === images?.[index]?.src
          ? loaded.src
          : "";
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const currentName = images?.[index]?.fileName ?? fileName;
    const imageActions = useImageActions(
      {
        src: failedSrc === currentSrc ? "" : currentSrc,
        fileName: currentName,
        localPath: localImagePath(images?.[index]?.src ?? originalRef),
      },
      { allowAdd: allowAddToChat, allowCopy: showCopyButton, onAdded: onClose }
    );
    const count = images?.length ?? 1;
    const failed =
      loaded?.index === index &&
      loaded.original === images?.[index]?.src &&
      loaded.failed;
    useImagePinchZoom(
      viewportRef,
      currentSrc && failedSrc !== currentSrc ? currentSrc : null,
      zoom,
      setZoom
    );

    useEffect(() => {
      if (index === initialIndex || !images || !resolveImage) return;
      let cancelled = false;
      let ownedUrl: string | null = null;
      const original = images[index].src;
      void resolveImage(original).then(
        (src) => {
          if (cancelled) {
            if (src !== original) releaseImageUrl(src);
            return;
          }
          ownedUrl = src !== original ? src : null;
          setLoaded({ index, original, src });
        },
        () => {
          if (!cancelled) setLoaded({ index, original, src: "", failed: true });
        }
      );
      return () => {
        cancelled = true;
        releaseImageUrl(ownedUrl);
      };
    }, [index, initialIndex, images, resolveImage]);

    const navigate = (next: number) => {
      const target = Math.max(0, Math.min(count - 1, next));
      if (target === index) return;
      setLoaded(null);
      setFailedSrc(null);
      setIndex(target);
      setZoom(100);
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
        viewportRef.current.scrollLeft = 0;
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, [role="slider"]'))
        return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        navigate(index + (event.key === "ArrowLeft" ? -1 : 1));
      }
    };

    const handleCopy = useCallback(
      () => imageActions.copy(imageRef.current),
      [imageActions]
    );

    return (
      <div onKeyDown={handleKeyDown}>
        <Modal
          visible
          onClose={onClose}
          title={currentName || t("imagePreview.dialogLabel")}
          aria-label={t("imagePreview.dialogLabel")}
          width={960}
          className="h-[80dvh] min-w-0!"
          bodyClassName="flex min-h-0 flex-1 items-center justify-center overflow-hidden! bg-fill-1 p-3"
          closable={false}
          headerActions={
            <>
              {imageActions.busy && (
                <span role="status" className="text-xs text-text-3">
                  {t("actions.loading")}
                </span>
              )}
              {showCopyButton && (
                <PreviewAction
                  label={t("imagePreview.copyImage")}
                  icon={Copy01Icon}
                  onClick={handleCopy}
                  disabled={
                    imageActions.busy || !currentSrc || failedSrc === currentSrc
                  }
                />
              )}
              <PreviewAction
                label={t("imagePreview.downloadImage")}
                icon={Download01Icon}
                onClick={imageActions.download}
                disabled={
                  imageActions.busy || !currentSrc || failedSrc === currentSrc
                }
              />
              <PreviewAction
                label={t("imagePreview.closePreview")}
                icon={Cancel01Icon}
                onClick={onClose}
              />
            </>
          }
          footer={
            <div className="flex shrink-0 justify-center bg-fill-1 px-3 pt-1 pb-3">
              <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-border-2 bg-bg-2 px-2 py-1 shadow-sm">
                {count > 1 && (
                  <>
                    <PreviewAction
                      label={t("actions.previous")}
                      icon={ArrowLeft01Icon}
                      onClick={() => navigate(index - 1)}
                      disabled={index === 0}
                    />
                    <span
                      className="px-1 text-xs text-text-3 tabular-nums"
                      role="status"
                    >
                      {index + 1} / {count}
                    </span>
                    <PreviewAction
                      label={t("actions.next")}
                      icon={ArrowRight01Icon}
                      onClick={() => navigate(index + 1)}
                      disabled={index === count - 1}
                    />
                    <span
                      className="mx-1 h-4 w-px bg-border-2"
                      aria-hidden="true"
                    />
                  </>
                )}
                <PreviewAction
                  label={t("tooltips.zoomOut")}
                  icon={MinusSignIcon}
                  onClick={() => setZoom((value) => Math.max(25, value - 25))}
                  disabled={
                    zoom === 25 || !currentSrc || failedSrc === currentSrc
                  }
                />
                <Slider
                  min={25}
                  max={400}
                  step={5}
                  value={zoom}
                  aria-label={t("tooltips.zoomIn")}
                  disabled={!currentSrc || failedSrc === currentSrc}
                  onValueChange={(value) => {
                    if (typeof value === "number") setZoom(value);
                  }}
                  formatTooltip={(value) => `${value}%`}
                  className="w-28!"
                  noPadding
                  handleBordered
                />
                <PreviewAction
                  label={t("tooltips.zoomIn")}
                  icon={Add01Icon}
                  onClick={() => setZoom((value) => Math.min(400, value + 25))}
                  disabled={
                    zoom === 400 || !currentSrc || failedSrc === currentSrc
                  }
                />
                <Button
                  size="small"
                  variant="tertiary"
                  shape="round"
                  className="min-w-14 tabular-nums"
                  title={t("tooltips.resetZoom")}
                  aria-label={t("tooltips.resetZoom")}
                  disabled={!currentSrc || failedSrc === currentSrc}
                  onClick={() => {
                    setZoom(100);
                    if (viewportRef.current) {
                      viewportRef.current.scrollTop = 0;
                      viewportRef.current.scrollLeft = 0;
                    }
                  }}
                >
                  {zoom}%
                </Button>
              </div>
            </div>
          }
        >
          {currentSrc && failedSrc !== currentSrc ? (
            <div
              ref={viewportRef}
              className="h-full min-h-0 w-full overflow-auto"
              onContextMenu={imageActions.onContextMenu}
              onKeyDown={imageActions.onKeyDown}
              tabIndex={0}
              data-image-viewport
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: `${Math.max(100, zoom)}%`,
                  height: `${Math.max(100, zoom)}%`,
                }}
              >
                <img
                  key={currentSrc}
                  ref={imageRef}
                  src={currentSrc}
                  alt={currentName || t("imagePreview.previewAlt")}
                  onError={() => setFailedSrc(currentSrc)}
                  className="max-w-none shrink-0 object-contain"
                  style={{
                    width: `${Math.min(100, zoom)}%`,
                    height: `${Math.min(100, zoom)}%`,
                  }}
                  draggable={false}
                />
              </div>
            </div>
          ) : (
            <div
              className="flex h-48 items-center justify-center text-sm text-text-3"
              role="status"
            >
              {failed || failedSrc === currentSrc
                ? t("errors.failedToLoad")
                : t("actions.loading")}
            </div>
          )}
        </Modal>
      </div>
    );
  }
);

ImagePreviewOverlay.displayName = "ImagePreviewOverlay";

export default ImagePreviewOverlay;
