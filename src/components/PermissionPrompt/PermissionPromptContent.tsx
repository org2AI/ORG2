/**
 * Shared permission prompt body — command block and args preview.
 */
import React from "react";

import type { PermissionArgPreview } from "./permissionPromptHelpers";

export interface PermissionPromptContentProps {
  commandText?: string | null;
  description?: string | null;
  argsPreview?: PermissionArgPreview[];
  /** Extra context line (e.g. mobile remote execution notice). */
  footerNote?: React.ReactNode;
  className?: string;
  /** Mobile adapts shared content roles without changing Desktop defaults. */
  typography?: "default" | "mobile";
}

export function PermissionPromptContent({
  commandText,
  description,
  argsPreview = [],
  footerNote,
  className = "",
  typography = "default",
}: PermissionPromptContentProps) {
  const bodyStyle =
    typography === "mobile"
      ? {
          fontSize: "var(--mobile-type-secondary-size, 14px)",
          lineHeight: "var(--mobile-type-body-leading, 1.5)",
        }
      : undefined;
  const captionStyle =
    typography === "mobile"
      ? {
          fontSize: "var(--mobile-type-caption-size, 12px)",
          lineHeight: "var(--mobile-type-caption-leading, 1.5)",
        }
      : undefined;
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      {commandText ? (
        <div>
          <div className="rounded-md bg-fill-2 px-3 py-2">
            <code
              style={bodyStyle}
              className="text-sm font-semibold break-all text-primary-6"
            >
              {commandText}
            </code>
          </div>
          {description ? (
            <p
              style={bodyStyle}
              className="mt-2 text-sm leading-relaxed text-text-2"
            >
              {description}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          {description ? (
            <p
              style={bodyStyle}
              className="text-sm leading-relaxed text-text-2"
            >
              {description}
            </p>
          ) : null}
          {argsPreview.length > 0 ? (
            <div className="scrollbar-overlay mt-2 flex max-h-[160px] flex-col gap-1 overflow-y-auto">
              {argsPreview.map(({ key, value }) => (
                <div
                  key={key}
                  style={bodyStyle}
                  className="flex gap-1.5 text-sm leading-relaxed"
                >
                  <span className="shrink-0 font-medium text-text-3">
                    {key}:
                  </span>
                  <span className="break-all text-text-2">{value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {footerNote ? (
        <p style={captionStyle} className="text-xs leading-relaxed text-text-3">
          {footerNote}
        </p>
      ) : null}
    </div>
  );
}

PermissionPromptContent.displayName = "PermissionPromptContent";
