import type { ReactNode } from "react";

import type { PillGroupSegment } from "@src/components/PillGroup";

import { SessionInfoPillGroup } from "./SessionInfoPillGroup";

/** Layout follows the composer width, including workstation/split resizing. */
export function SessionInfoRow({
  segments,
  strongSurface = true,
  leadingContent,
}: {
  segments: PillGroupSegment[];
  strongSurface?: boolean;
  leadingContent?: ReactNode;
}) {
  const pills = (
    <SessionInfoPillGroup segments={segments} strongSurface={strongSurface} />
  );

  if (!leadingContent) return pills;

  // 28rem reserves room for GUI/TUI plus three useful selector labels. Below
  // that width the mode switch gets its own row; its divider disappears with
  // it, so resizing cannot strand a divider on either line.
  return (
    <div
      data-testid="session-info-row"
      className="@container/session-info w-full max-w-full min-w-0"
    >
      <div className="flex min-w-0 flex-col items-start @min-[28rem]/session-info:flex-row @min-[28rem]/session-info:items-center">
        <div data-testid="session-info-leading" className="flex shrink-0">
          {leadingContent}
        </div>
        <span
          aria-hidden
          data-testid="session-info-leading-divider"
          className="hidden h-3 w-px shrink-0 bg-border-2 @min-[28rem]/session-info:inline-flex"
        />
        <div className="flex w-full min-w-0 @min-[28rem]/session-info:w-auto @min-[28rem]/session-info:flex-1">
          {pills}
        </div>
      </div>
    </div>
  );
}
