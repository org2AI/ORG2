import React, { useCallback } from "react";

import HoverCardBase from "./HoverCardBase";

export type HoverCardTriggerProps = Pick<
  React.ComponentProps<typeof HoverCardBase>,
  "children" | "position" | "mouseEnterDelay" | "mouseLeaveDelay"
>;

type HoverCardProps = Omit<
  React.ComponentProps<typeof HoverCardBase>,
  "renderContent"
> & { content: React.ReactNode };

/** Elements are mounted only by the active portal; deferred content stays lazy. */
export default function HoverCard({ content, ...props }: HoverCardProps) {
  const renderContent = useCallback(() => content, [content]);
  return <HoverCardBase {...props} renderContent={renderContent} />;
}
