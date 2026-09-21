/**
 * InfoRow — compact 12px label/value row for detail panel cards.
 *
 * Accepts either a `value` string or `children` for complex content
 * (toggles, buttons, badges, etc.).
 *
 * layout: "horizontal" (default) — label left, value right
 *         "vertical" — label on top, content below (like SectionRow)
 */
import React from "react";

interface InfoRowProps {
  label: string;
  value?: string;
  children?: React.ReactNode;
  /** "horizontal" (default) or "vertical" — vertical stacks label above content */
  layout?: "horizontal" | "vertical";
}

export const InfoRow: React.FC<InfoRowProps> = ({
  label,
  value,
  children,
  layout = "horizontal",
}) => {
  const content = children ?? (
    <span
      className={`text-[12px] text-text-1 ${layout === "vertical" ? "wrap-break-word" : "block max-w-full truncate text-right"}`}
      title={value}
    >
      {value}
    </span>
  );

  const labelBlock = (
    <span className="flex min-h-[24px] shrink-0 items-center gap-1.5 text-[12px] font-medium text-text-2">
      {label}
    </span>
  );

  if (layout === "vertical") {
    return (
      <div className="flex min-h-[24px] flex-col gap-1">
        {labelBlock}
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[24px] min-w-0 items-center justify-between gap-3">
      {labelBlock}
      <div className="flex min-w-0 flex-1 items-center justify-end">
        {content}
      </div>
    </div>
  );
};
