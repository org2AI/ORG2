/**
 * ImageBottomBar Component
 *
 * Shared bottom bar for image preview and image diff views.
 * Two modes:
 *   - "preview": shows metadata + zoom controls
 *   - "diff": shows old → new file info with color-coded sizes
 */
import React from "react";

import Button from "@src/components/Button";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  ArrowExpand01Icon,
  ArrowRight02Icon,
  HugeiconsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@src/icons";

import { PreviewBottomBar, formatFileSize } from "../PreviewBottomBar";

// ============================================
// Types
// ============================================

interface ImageInfo {
  width: number;
  height: number;
  size: number;
}

interface PreviewModeProps {
  mode: "preview";
  metadata: { naturalSize: string; format: string } | null;
  fileSize: number | null;
  zoom: number;
  fitMode: boolean;
  onFit: () => void;
  onActualSize: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  minZoom: number;
  maxZoom: number;
}

interface DiffModeProps {
  mode: "diff";
  oldImage: ImageInfo | null;
  newImage: ImageInfo | null;
  status: string;
  zoom: number;
  fitMode: boolean;
  onFit: () => void;
  onActualSize: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  minZoom: number;
  maxZoom: number;
}

export type ImageBottomBarProps = PreviewModeProps | DiffModeProps;

// ============================================
// Component
// ============================================

export const ImageBottomBar: React.FC<ImageBottomBarProps> = (props) => {
  if (props.mode === "preview") {
    return (
      <PreviewBottomBar
        left={<PreviewLeft {...props} />}
        right={<ZoomControls {...props} />}
      />
    );
  }
  return (
    <PreviewBottomBar
      left={<DiffLeft {...props} />}
      right={<ZoomControls {...props} />}
    />
  );
};

// ============================================
// Left slot — preview metadata
// ============================================

const PreviewLeft: React.FC<PreviewModeProps> = ({ metadata, fileSize }) => (
  <>
    {metadata && (
      <>
        <span>{metadata.naturalSize}</span>
        <span>{metadata.format}</span>
        {fileSize !== null && <span>{formatFileSize(fileSize)}</span>}
      </>
    )}
  </>
);

// ============================================
// Left slot — diff metadata
// ============================================

const DiffLeft: React.FC<DiffModeProps> = ({ oldImage, newImage, status }) => {
  const isAdded = status === "added";
  const isDeleted = status === "deleted";
  return (
    <div className="flex items-center gap-2">
      {oldImage ? (
        <span className="text-danger-6">
          {oldImage.width} × {oldImage.height} · {formatFileSize(oldImage.size)}
        </span>
      ) : (
        <span>{isAdded ? "New file" : "—"}</span>
      )}
      <HugeiconsIcon
        icon={ArrowRight02Icon}
        data-icon="arrow-right"
        size={12}
        className="text-text-3"
      />
      {newImage ? (
        <span className="text-success-6">
          {newImage.width} × {newImage.height} · {formatFileSize(newImage.size)}
        </span>
      ) : (
        <span>{isDeleted ? "Deleted" : "—"}</span>
      )}
    </div>
  );
};

// ============================================
// Right slot — zoom controls (shared by both modes)
// ============================================

type ZoomProps = Pick<
  PreviewModeProps,
  | "zoom"
  | "fitMode"
  | "onFit"
  | "onActualSize"
  | "onZoomIn"
  | "onZoomOut"
  | "minZoom"
  | "maxZoom"
>;

const ZoomControls: React.FC<ZoomProps> = ({
  zoom,
  fitMode,
  onFit,
  onActualSize,
  onZoomIn,
  onZoomOut,
  minZoom,
  maxZoom,
}) => {
  const zoomPercent = `${Math.round(zoom * 100)}%`;
  return (
    <>
      <Button
        variant="tertiary"
        size="sidebar"
        aria-pressed={fitMode}
        iconOnly
        icon={
          <HugeiconsIcon
            icon={ArrowExpand01Icon}
            data-icon="maximize"
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={1.75}
          />
        }
        onClick={onFit}
      />
      <Button
        variant="tertiary"
        size="sidebar"
        aria-pressed={!fitMode && zoom === 1}
        iconOnly
        icon={<span className="text-[11px] font-medium">1:1</span>}
        onClick={onActualSize}
      />
      <div className="mx-1 h-3 w-px bg-border-2" />
      <Button
        variant="tertiary"
        size="sidebar"
        iconOnly
        icon={
          <HugeiconsIcon
            icon={ZoomOutIcon}
            data-icon="zoom-out"
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={1.75}
          />
        }
        onClick={onZoomOut}
        disabled={zoom <= minZoom}
      />
      <span className="min-w-[40px] text-center text-[11px] text-text-2">
        {zoomPercent}
      </span>
      <Button
        variant="tertiary"
        size="sidebar"
        iconOnly
        icon={
          <HugeiconsIcon
            icon={ZoomInIcon}
            data-icon="zoom-in"
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={1.75}
          />
        }
        onClick={onZoomIn}
        disabled={zoom >= maxZoom}
      />
    </>
  );
};

export default ImageBottomBar;
