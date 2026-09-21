import React from "react";

import { NoDragRegion } from "./NoDragRegion";

/** Stable 36px chrome row; buttons keep their shared size and a 1px gap. */
export function HeaderActionGroup({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <NoDragRegion
      {...props}
      className={`flex h-9 shrink-0 items-center gap-px ${className}`.trim()}
    >
      {children}
    </NoDragRegion>
  );
}
