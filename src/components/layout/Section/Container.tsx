/**
 * SectionContainer Component
 *
 * Semantic page container for structured pages.
 * Optional sub-section title above the card.
 *
 * Usage:
 *   <SectionContainer title="Layout">
 *     <SectionRow label="Theme"><Select /></SectionRow>
 *   </SectionContainer>
 */
import React, { memo } from "react";

import CollapsibleSection from "@src/components/layout/blocks/CollapsibleSection";

import {
  SECTION_CONTAINER_CLASSES,
  SECTION_PADDING,
  SECTION_SUBHEADING_CLASSES,
} from "./tokens";

export interface SectionContainerProps {
  /** Stable selector for rendered tests and external UI drivers. */
  dataTestId?: string;
  /** Container content */
  children: React.ReactNode;
  /** Optional sub-section title above the card */
  title?: string;
  /** Allow the standard string title to expand and collapse the card content. */
  collapsible?: boolean;
  /** Initial visibility for collapsible content. */
  defaultOpen?: boolean;
  /** Optional test selector for the collapsible title button. */
  titleButtonTestId?: string;
  /**
   * Optional fully-custom title row (e.g. a TabPill). When provided, this
   * REPLACES the `title` string rendering — the container draws this node
   * as the title row above the card and ignores `title`.
   */
  titleSlot?: React.ReactNode;
  /** Optional className for additional styling */
  className?: string;
  /** Vertical padding variant (default: "none" — px-4 is always applied) */
  padding?: "none" | "default" | "compact";
}

const SectionContainer: React.FC<SectionContainerProps> = memo(
  ({
    children,
    title,
    collapsible = false,
    defaultOpen = true,
    titleButtonTestId,
    titleSlot,
    dataTestId,
    className = "",
    padding = "none",
  }) => {
    const card = (
      <div
        data-testid={dataTestId}
        className={`${SECTION_CONTAINER_CLASSES} ${SECTION_PADDING[padding]} ${className}`.trim()}
      >
        {children}
      </div>
    );

    if (!title && !titleSlot) return card;
    if (collapsible && title && !titleSlot) {
      return (
        <div className="not-first:mt-3">
          <CollapsibleSection
            title={title}
            defaultOpen={defaultOpen}
            compact
            titleClassName={SECTION_SUBHEADING_CLASSES}
            titleButtonTestId={titleButtonTestId}
          >
            {card}
          </CollapsibleSection>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 not-first:mt-3">
        {titleSlot ? (
          // Match the pl-1 baked into SECTION_SUBHEADING_CLASSES so a custom
          // title row (e.g. TabPill) lines up with the static-title path and
          // with rows inside the card below.
          <div className="pl-1">{titleSlot}</div>
        ) : (
          <div className={SECTION_SUBHEADING_CLASSES}>{title}</div>
        )}
        {card}
      </div>
    );
  }
);

SectionContainer.displayName = "SectionContainer";

export default SectionContainer;
