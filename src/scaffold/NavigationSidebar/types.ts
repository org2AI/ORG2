import type { ReactNode, Ref } from "react";

import type { IconSvgElement } from "@src/icons";

/** SidebarBase props */
export interface SidebarBaseProps {
  /** Children content */
  children: ReactNode;
  /** Additional class names */
  className?: string;
  /** Add new item callback (shows plus button in traffic lights area) */
  onAddNew?: () => void;
  /** Icon for add button */
  addIcon?: IconSvgElement;
  /** Label for add button tooltip */
  addLabel?: string;
  /** Optional rich tooltip content for the add button. */
  addTooltipContent?: ReactNode;
  /** Extra controls rendered before the add button. */
  beforeAddNewActions?: ReactNode;
  /** Extra controls to the right of the add button (e.g. session group-by filter) */
  headerActions?: ReactNode;
  /** Content rendered in its own row directly below the chrome row. */
  topBarFollowingContent?: ReactNode;
}

/** SidebarList props */
export interface SidebarListProps {
  /** Children content */
  children: ReactNode;
  /** Optional ref to the scroll container for scoped reveal/navigation. */
  scrollContainerRef?: Ref<HTMLDivElement>;
  /** Loading state */
  isLoading?: boolean;
  /** Optional loading UI for surfaces that can mirror their eventual rows. */
  loadingContent?: ReactNode;
  /** Additional class names */
  className?: string;
  /** Use "row" to match the menu's gap-1 spacing across the pinned boundary. */
  topPadding?: boolean | "row";
}
