import type { ReactNode } from "react";

const REVEAL_CLASSES = {
  sidebar: "hidden group-focus-within/sidebar:flex group-hover/sidebar:flex",
  item: "hidden group-focus-within/item:flex group-hover/item:flex",
  header: "hidden group-focus-within/header:flex group-hover/header:flex",
  section: "hidden group-focus-within/section:flex group-hover/section:flex",
} as const;

interface TreeRowActionGroupProps {
  children: ReactNode;
  hoverGroup?: keyof typeof REVEAL_CLASSES;
  alwaysVisible?: boolean;
}

/** Compact actions reveal together; one owner for spacing and visibility. */
export function TreeRowActionGroup({
  children,
  hoverGroup = "item",
  alwaysVisible = false,
}: TreeRowActionGroupProps) {
  return (
    <div
      className={`shrink-0 items-center gap-px ${alwaysVisible ? "flex" : `${REVEAL_CLASSES[hoverGroup]} has-data-[state=open]:flex`}`}
    >
      {children}
    </div>
  );
}
