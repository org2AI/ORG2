import type { ReactNode } from "react";

import { LIST_PANEL_SECTIONS } from "@src/components/ListPanel";
import { CollapsibleSection } from "@src/components/layout/blocks";
import { WORKSTATION_TRAIL_SECTION_LABEL } from "@src/config/workstation/tokens";

export function TeamInboxListSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section data-testid={testId} aria-label={title} className="mb-2 last:mb-0">
      <CollapsibleSection
        title={title}
        compact
        headerRowClassName="mb-px h-7"
        titleButtonClassName="group/section-title h-7 w-full gap-1 pl-2"
        titleClassName={`order-first min-w-0 truncate ${WORKSTATION_TRAIL_SECTION_LABEL} transition-colors group-hover/section-title:text-text-2`}
        chevronContainerClassName="order-last hidden shrink-0 items-center leading-none group-aria-[expanded=false]/section-title:inline-flex group-hover/section-title:inline-flex group-focus-visible/section-title:inline-flex"
        chevronSize={14}
        chevronStrokeWidth={1.75}
        chevronClassName="text-text-3 group-hover/section-title:text-text-2"
        titleButtonTestId={`${testId}-toggle`}
      >
        <div className={LIST_PANEL_SECTIONS.sectionGroupItems}>{children}</div>
      </CollapsibleSection>
    </section>
  );
}
