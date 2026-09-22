import type { ReactNode } from "react";

import { SECTION_SUBHEADING_CLASSES } from "@src/components/layout/Section";

/** 36px — the one row height every Runtime tab's leading header shares. */
export const RUNTIME_SECTION_HEADER_HEIGHT = "h-9";

interface RuntimeSectionHeaderProps {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
  dataTestId?: string;
  headingLevel?: "h2" | "h3" | "h4";
}

/**
 * Common title/action row for Runtime sections. Keeping this small makes the
 * title baseline and page-level actions consistent without constraining the
 * layout of the section content beneath it.
 *
 * The row is exactly {@link RUNTIME_SECTION_HEADER_HEIGHT} tall, never merely
 * at least that: every Runtime tab leads with one of these, so a row that grew
 * with its content — or a caller that padded it — would move the whole tab's
 * content down relative to its neighbours and make switching tabs jump. Give
 * actions a control no taller than the row rather than letting the row grow,
 * and keep caller `className`s to horizontal and background treatments.
 */
export function RuntimeSectionHeader({
  title,
  children,
  className,
  dataTestId,
  headingLevel = "h3",
}: RuntimeSectionHeaderProps): ReactNode {
  const Heading = headingLevel;

  return (
    <div
      className={`${RUNTIME_SECTION_HEADER_HEIGHT} flex shrink-0 items-center justify-between gap-3 ${className ?? ""}`}
      data-testid={dataTestId}
    >
      <Heading className={SECTION_SUBHEADING_CLASSES}>{title}</Heading>
      {children ? (
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      ) : null}
    </div>
  );
}
