import React, { type ReactNode } from "react";

interface SidebarRowContentProps {
  label: ReactNode;
  metadata?: ReactNode;
  detail?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  title?: string;
  labelClassName?: string;
  compact?: boolean;
}

/** Presentation slots only; callers retain tree, navigation and loading behavior. */
export function SidebarRowContent({
  label,
  metadata,
  detail,
  leading,
  trailing,
  title,
  labelClassName = "text-[13px] font-normal text-text-2",
  compact = false,
}: SidebarRowContentProps) {
  const multiline = metadata != null || detail != null;
  return (
    <>
      {leading}
      <span
        className={`flex min-w-0 flex-1 flex-col ${compact ? "" : "gap-0.5"}`}
      >
        <span
          className={`flex min-w-0 items-center gap-1 overflow-hidden ${multiline ? (compact ? "leading-4" : "leading-5") : ""} ${labelClassName}`}
          title={title}
        >
          {label}
        </span>
        {metadata != null && (
          <span className="truncate text-[11px] leading-4 font-normal text-text-3">
            {metadata}
          </span>
        )}
        {detail != null && (
          <span className="truncate text-[11px] leading-4 font-normal text-text-3">
            {detail}
          </span>
        )}
      </span>
      {trailing}
    </>
  );
}
