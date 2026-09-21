/**
 * ChatPanel's Markdown renderer extensions.
 *
 * The chat surface owns the fenced-block chrome the renderer draws inside a
 * transcript: the collapsible code block, the inline canvas card, and the
 * event-block header Mermaid reuses. They used to be imported *up* out of
 * `components/MarkDown/`; now ChatPanel hands them to the renderer's slot
 * registry at bootstrap instead.
 *
 * Side-effect free to import: `src/app/root` calls the export below.
 */
import React from "react";

import type {
  MarkdownBlockHeaderProps,
  MarkdownExtensions,
} from "@src/components/MarkDown/extensions";

import CanvasInlineCard from "../blocks/CanvasInlineCard";
import ChatCodeBlock from "../blocks/CodeBlock";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "../blocks/primitives";

const ChatMarkdownBlockHeader: React.FC<MarkdownBlockHeaderProps> = ({
  title,
  icon,
  isCollapsed,
  isHeaderHovered,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  rightContent,
}) => (
  <EventBlockHeader
    isCollapsed={isCollapsed}
    withHover={false}
    onToggleCollapse={onToggle}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    rightContent={rightContent}
  >
    <EventBlockHeaderIcon
      icon={icon}
      isCollapsed={isCollapsed}
      isHeaderHovered={isHeaderHovered}
      hasContent
    />
    <EventBlockHeaderTitle>{title}</EventBlockHeaderTitle>
  </EventBlockHeader>
);
ChatMarkdownBlockHeader.displayName = "ChatMarkdownBlockHeader";

export const chatPanelMarkdownExtensions: MarkdownExtensions = {
  ChatCodeBlock,
  CanvasInlineCard,
  blockChrome: {
    containerClassName: getEventBlockContainerClasses,
    Header: ChatMarkdownBlockHeader,
  },
};
