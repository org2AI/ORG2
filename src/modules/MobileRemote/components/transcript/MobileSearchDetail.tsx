import React from "react";

import { HugeiconsIcon, Search01Icon } from "@src/icons";

import type { MobileSearchDetail as MobileSearchDetailModel } from "./mobileToolPresentation";

interface MobileSearchDetailProps extends MobileSearchDetailModel {
  isLoading: boolean;
  isFailed: boolean;
  truncated: boolean;
  truncatedLabel: string;
}

/** Narrow-screen counterpart to Desktop's SearchBlock presentation. */
export function MobileSearchDetail({
  query,
  output,
  isLoading,
  isFailed,
  truncated,
  truncatedLabel,
}: MobileSearchDetailProps) {
  const state = isFailed ? "failed" : isLoading ? "running" : "done";

  return (
    <section
      className="mobile-search-detail"
      data-mobile-tool-detail-kind="search"
      data-mobile-tool-detail-state={state}
    >
      <div className="mobile-search-detail__frame">
        {query ? (
          <div className="mobile-search-detail__query">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <pre>{query}</pre>
          </div>
        ) : null}
        {output ? (
          <pre
            className="mobile-search-detail__results"
            aria-live={isLoading ? "polite" : undefined}
          >
            {output}
          </pre>
        ) : null}
      </div>
      {truncated ? (
        <p className="mobile-tool-detail__truncated mobile-type-caption text-text-3">
          {truncatedLabel}
        </p>
      ) : null}
    </section>
  );
}

MobileSearchDetail.displayName = "MobileSearchDetail";
