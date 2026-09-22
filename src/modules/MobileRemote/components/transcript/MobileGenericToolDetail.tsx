import React from "react";

interface MobileGenericToolDetailProps {
  itemId: string;
  summary: string;
  metadataText: string;
  output: string;
  truncated: boolean;
  detailsLabel: string;
  outputLabel: string;
  truncatedLabel: string;
}

/** Read-only fallback for tools without a dedicated mobile presentation. */
export function MobileGenericToolDetail({
  itemId,
  summary,
  metadataText,
  output,
  truncated,
  detailsLabel,
  outputLabel,
  truncatedLabel,
}: MobileGenericToolDetailProps) {
  return (
    <div
      data-mobile-tool-detail={itemId}
      data-mobile-tool-detail-kind="generic"
    >
      {summary ? (
        <pre className="mobile-tool-preview__summary mobile-type-code">
          {summary}
        </pre>
      ) : null}
      {metadataText ? (
        <section className="mobile-tool-preview__section">
          <div className="mobile-tool-preview__label mobile-type-caption">
            {detailsLabel}
          </div>
          <pre className="mobile-tool-preview__code mobile-type-code">
            {metadataText}
          </pre>
        </section>
      ) : null}
      {output ? (
        <section className="mobile-tool-preview__section">
          <div className="mobile-tool-preview__label mobile-type-caption">
            {outputLabel}
          </div>
          <pre className="mobile-tool-preview__code mobile-type-code">
            {output}
          </pre>
        </section>
      ) : null}
      {truncated ? (
        <p className="mobile-tool-detail__truncated mobile-type-caption text-text-3">
          {truncatedLabel}
        </p>
      ) : null}
    </div>
  );
}

MobileGenericToolDetail.displayName = "MobileGenericToolDetail";
