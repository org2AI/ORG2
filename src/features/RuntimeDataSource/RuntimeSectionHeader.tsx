import type { ReactNode } from "react";

import { SECTION_SUBHEADING_CLASSES } from "@src/components/layout/Section";

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
      className={`flex min-h-9 items-center justify-between gap-3 ${className ?? ""}`}
      data-testid={dataTestId}
    >
      <Heading className={SECTION_SUBHEADING_CLASSES}>{title}</Heading>
      {children ? (
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      ) : null}
    </div>
  );
}
