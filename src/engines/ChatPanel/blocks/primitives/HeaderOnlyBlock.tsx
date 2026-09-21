/**
 * HeaderOnlyBlock — the shared scaffold for chat blocks that are a header and
 * nothing else: icon + title + optional subtitle, no body, no chevron.
 *
 * `TitleOnlyBlock`, `SearchBlock`, `GlobBlock`, `ListDirBlock` and
 * `SkillBlock` were five copies of the same 40-line `useBlockHeader` +
 * `EventBlockHeader` wiring. They are not identical, though, and the
 * differences are real rather than drift — so they are props here rather than
 * something flattened away:
 *
 * - **`collapseParticipation`**: the tool blocks pass `collapseAllValue` to
 *   `useEventBlockHeader`, which is what makes a block take part in collapse
 *   all (`participates = collapseAllValue !== undefined`). `TitleOnlyBlock`
 *   and `SkillBlock` do not take part. The flag carries that whole option set.
 * - **`animate`**: only `TitleOnlyBlock` and `SkillBlock` fade in.
 * - **subtitle decoration**: the tool blocks give the subtitle a native
 *   tooltip, `text-text-1`, and a truncating span; `GlobBlock` additionally
 *   prefixes a file-type icon.
 */
import React from "react";

import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";

import ToolUsageBadge from "../ToolCallBlock/ToolUsageBadge";
import { useBlockHeader } from "../useBlockLocate";
import { EventBlockHeader } from "./EventBlockHeader";
import { EventBlockHeaderIcon } from "./EventBlockHeaderIcon";
import {
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
} from "./EventBlockHeaderTextSlots";
import { getEventBlockContainerClasses } from "./config";

export interface HeaderOnlyBlockProps {
  /** Header icon, already resolved by the caller. */
  icon: React.ReactNode;
  /** Pre-translated, state-aware header title. */
  title: React.ReactNode;
  /** Optional second line. Nothing renders when empty. */
  subtitle?: React.ReactNode;
  /** Native tooltip for the subtitle (tool blocks show the full path). */
  subtitleTitle?: string;
  /** Extra classes on the subtitle slot, e.g. `text-text-1`. */
  subtitleClassName?: string;
  /** Rendered inside the subtitle slot, before the text (file-type icon). */
  subtitlePrefix?: React.ReactNode;
  /** Wrap the subtitle in a truncating span. */
  truncateSubtitle?: boolean;
  isLoading?: boolean;
  isFailed?: boolean;
  /** Wires the header to event-replay locate. */
  eventId?: string;
  toolUsage?: ToolUsageMetadata;
  /** Fade the block in on mount. */
  animate?: boolean;
  /** Take part in collapse all (see the note above). */
  collapseParticipation?: boolean;
  /** Extra attributes for the container, e.g. `data-tool-call-name`. */
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}

const HeaderOnlyBlock: React.FC<HeaderOnlyBlockProps> = React.memo(
  ({
    icon,
    title,
    subtitle,
    subtitleTitle,
    subtitleClassName,
    subtitlePrefix,
    truncateSubtitle = false,
    isLoading = false,
    isFailed = false,
    eventId,
    toolUsage,
    animate = false,
    collapseParticipation = false,
    containerProps,
  }) => {
    const {
      isHeaderHovered,
      handleHeaderMouseEnter,
      handleHeaderMouseLeave,
      handleLocate,
    } = useBlockHeader(
      collapseParticipation
        ? {
            defaultCollapsed: true,
            eventId,
            collapseAllValue: false,
            preserveDefaultOnExpand: true,
          }
        : { eventId }
    );

    const hasSubtitle = subtitle != null && subtitle !== "";

    return (
      <div
        {...containerProps}
        className={`${getEventBlockContainerClasses(false)}${animate ? "animate-fade-in" : ""}`}
      >
        <EventBlockHeader
          isCollapsed
          withHover={false}
          onNavigate={handleLocate}
          onMouseEnter={handleHeaderMouseEnter}
          onMouseLeave={handleHeaderMouseLeave}
          rightContent={
            toolUsage ? <ToolUsageBadge usage={toolUsage} /> : undefined
          }
        >
          <EventBlockHeaderIcon
            icon={icon}
            isCollapsed
            isHeaderHovered={isHeaderHovered}
            hasContent={false}
            isLoading={isLoading}
            isFailed={isFailed}
          />
          <EventBlockHeaderTitle isLoading={isLoading}>
            {title}
          </EventBlockHeaderTitle>
          {hasSubtitle && (
            <EventBlockHeaderSubtitle
              isLoading={isLoading}
              title={subtitleTitle}
              className={subtitleClassName}
            >
              {subtitlePrefix}
              {truncateSubtitle ? (
                <span className="min-w-0 truncate">{subtitle}</span>
              ) : (
                subtitle
              )}
            </EventBlockHeaderSubtitle>
          )}
        </EventBlockHeader>
      </div>
    );
  }
);

HeaderOnlyBlock.displayName = "HeaderOnlyBlock";

export default HeaderOnlyBlock;
