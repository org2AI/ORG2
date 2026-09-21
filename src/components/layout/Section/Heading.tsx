/**
 * SectionHeading Component
 *
 * Top-level heading for a page section — sticky title + gap.
 * Replaces the manual pattern of SECTION_GAP_CLASSES + SECTION_HEADING_CLASSES + <h2>.
 *
 * Usage:
 *   <SectionHeading title="General">
 *     <SectionContainer>
 *       <SectionRow label="Language" />
 *     </SectionContainer>
 *   </SectionHeading>
 */
import React, { memo } from "react";

import { SECTION_GAP_CLASSES, SECTION_HEADING_CLASSES } from "./tokens";

export interface SectionHeadingProps {
  /** Heading text */
  title: string;
  /** Section content (containers, rows, etc.) */
  children?: React.ReactNode;
}

const SectionHeading: React.FC<SectionHeadingProps> = memo(
  ({ title, children }) => (
    <div>
      <div className={SECTION_GAP_CLASSES}>
        <h2
          className={`sticky top-0 z-30 bg-bg-2 pt-4 pb-1 ${SECTION_HEADING_CLASSES}`}
        >
          {title}
        </h2>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </div>
  )
);

SectionHeading.displayName = "SectionHeading";

export default SectionHeading;
