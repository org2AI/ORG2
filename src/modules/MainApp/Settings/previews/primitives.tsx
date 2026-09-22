/**
 * Building blocks for Settings preview sketches: tiny SVG diagrams that show
 * what a setting changes, used by a row's info-icon tooltip (every state side
 * by side) and by each option's own hover tooltip (that state alone).
 *
 * Every mark paints with `currentColor` from a theme text-token class, so the
 * sketches follow light/dark and accent without their own palette.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Tooltip from "@src/components/Tooltip";
import { HintWithInfo } from "@src/components/layout/blocks/HintWithInfo";

export const WIDTH = 132;
export const HEIGHT = 62;
export const MID = WIDTH / 2;
const ROW_TOP = 8;
export const ROW_H = 10;
const ROW_GAP = 2;
/** Left edge of code bars when a one/two-digit gutter is shown. */
export const CODE_X = 20;
/** Right edge of gutter numbers. */
const NUM_RIGHT = 14;

export const rowY = (row: number) => ROW_TOP + row * (ROW_H + ROW_GAP);

// ============================================
// Marks
// ============================================

export const Frame: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <svg
    width={WIDTH}
    height={HEIGHT}
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    aria-hidden="true"
    className="block"
  >
    {children}
    <rect
      x={0.5}
      y={0.5}
      width={WIDTH - 1}
      height={HEIGHT - 1}
      rx={5}
      className="text-text-4"
      fill="none"
      stroke="currentColor"
      strokeOpacity={0.5}
    />
  </svg>
);

/** A line of "code" (or text) drawn as a rounded bar, positioned by row. */
export const Bar: React.FC<{
  x: number;
  row: number;
  w: number;
  className?: string;
  opacity?: number;
}> = ({ x, row, w, className, opacity }) => (
  <TextBar
    x={x}
    y={rowY(row) + 3.5}
    w={w}
    className={className}
    opacity={opacity}
  />
);

/** A text stand-in bar at an absolute y (top edge). */
export const TextBar: React.FC<{
  x: number;
  y: number;
  w: number;
  className?: string;
  opacity?: number;
}> = ({ x, y, w, className = "text-text-4", opacity }) => (
  <rect
    x={x}
    y={y}
    width={w}
    height={3}
    rx={1.5}
    className={className}
    fill="currentColor"
    fillOpacity={opacity}
  />
);

/** A full-row background tint (changed line, active line). */
export const Tint: React.FC<{
  x: number;
  row: number;
  w: number;
  className: string;
  opacity?: number;
}> = ({ x, row, w, className, opacity = 0.16 }) => (
  <Area
    x={x}
    y={rowY(row)}
    w={w}
    h={ROW_H}
    className={className}
    opacity={opacity}
  />
);

/** A filled, rounded region (emphasis, overlays, pills). */
export const Area: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  className: string;
  opacity?: number;
  rx?: number;
}> = ({ x, y, w, h, className, opacity = 0.16, rx = 1.5 }) => (
  <rect
    x={x}
    y={y}
    width={w}
    height={h}
    rx={rx}
    className={className}
    fill="currentColor"
    fillOpacity={opacity}
  />
);

/** An outlined, rounded region (composer, chips, panels). */
export const Outline: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  className?: string;
}> = ({ x, y, w, h, rx = 4, className = "text-text-4" }) => (
  <rect
    x={x + 0.5}
    y={y + 0.5}
    width={w - 1}
    height={h - 1}
    rx={rx}
    className={className}
    fill="none"
    stroke="currentColor"
  />
);

export const LineNumber: React.FC<{
  row: number;
  value: string;
  x?: number;
  className?: string;
}> = ({ row, value, x = NUM_RIGHT, className = "text-text-3" }) =>
  value ? (
    <text
      x={x}
      y={rowY(row) + 7.5}
      textAnchor="end"
      fontSize={7}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      className={className}
      fill="currentColor"
    >
      {value}
    </text>
  ) : null;

export const Caret: React.FC<{ x: number; row: number }> = ({ x, row }) => (
  <rect
    x={x}
    y={rowY(row) + 1}
    width={1.2}
    height={ROW_H - 2}
    className="text-primary-6"
    fill="currentColor"
  />
);

export const VLine: React.FC<{
  x: number;
  y1?: number;
  y2?: number;
  opacity?: number;
}> = ({ x, y1 = 4, y2 = HEIGHT - 4, opacity = 0.5 }) => (
  <line
    x1={x}
    y1={y1}
    x2={x}
    y2={y2}
    className="text-text-4"
    stroke="currentColor"
    strokeOpacity={opacity}
  />
);

// ============================================
// Layout
// ============================================

export interface PreviewItem {
  caption: string;
  figure: React.ReactNode;
}

/** Captioned figures, two per row. */
export const PreviewGrid: React.FC<{ items: readonly PreviewItem[] }> = ({
  items,
}) => (
  <div className="grid grid-cols-2 gap-3 py-1">
    {items.map(({ caption, figure }) => (
      <figure key={caption} className="m-0 flex flex-col gap-1.5">
        {figure}
        <figcaption className="text-center text-xs text-text-2">
          {caption}
        </figcaption>
      </figure>
    ))}
  </div>
);

/** Off/On pair — the shape of every boolean setting's preview. */
export const OffOnPreview: React.FC<{
  render: (on: boolean) => React.ReactNode;
}> = ({ render }) => {
  const { t } = useTranslation("common");
  return (
    <PreviewGrid
      items={[
        { caption: t("common.off"), figure: render(false) },
        { caption: t("common.on"), figure: render(true) },
      ]}
    />
  );
};

/** One option's figure alone, for that option's hover tooltip. */
export const OptionPreview: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <div className="py-1">{children}</div>;

/**
 * Builds `{ caption, figure }` items from a control's options, so the row's
 * info tooltip and each option's own tooltip draw the same figure.
 */
export function previewItems<T extends string>(
  options: readonly { value: T; label: React.ReactNode }[],
  renderFigure: (value: T) => React.ReactNode
): PreviewItem[] {
  return options.map((option) => ({
    caption: String(option.label),
    figure: renderFigure(option.value),
  }));
}

/** Adds each option's figure as its hover tooltip. */
export function withOptionPreviews<
  T extends string,
  O extends { value: T; label: React.ReactNode },
>(
  options: readonly O[],
  renderFigure: (value: T) => React.ReactNode
): (O & { tooltip: React.ReactNode })[] {
  return options.map((option) => ({
    ...option,
    tooltip: <OptionPreview>{renderFigure(option.value)}</OptionPreview>,
  }));
}

/**
 * Dropdown variant of `withOptionPreviews`: menu rows get the figure as a
 * hover tooltip, while the closed trigger keeps the plain label.
 */
export function withDropdownOptionPreviews<
  T extends string,
  O extends { value: T; label: React.ReactNode },
>(
  options: readonly O[],
  renderFigure: (value: T) => React.ReactNode
): (O & { triggerLabel: React.ReactNode })[] {
  return options.map((option) => ({
    ...option,
    triggerLabel: option.label,
    label: (
      <Tooltip
        content={<OptionPreview>{renderFigure(option.value)}</OptionPreview>}
        position="left"
        framedPanel
        smartPlacement
      >
        <span className="block w-full">{option.label}</span>
      </Tooltip>
    ),
  }));
}

/** Row label with an info icon whose tooltip sketches the setting's states. */
export const LabelWithPreview: React.FC<{
  label: string;
  preview: React.ReactNode;
}> = ({ label, preview }) => (
  <span className="inline-flex items-center gap-1">
    {label}
    <HintWithInfo content={preview} position="right" />
  </span>
);

/** Off/On preview for a figure that takes an `on` flag. */
export const offOnPreview = (Figure: React.FC<{ on: boolean }>) => (
  <OffOnPreview render={(on) => <Figure on={on} />} />
);
