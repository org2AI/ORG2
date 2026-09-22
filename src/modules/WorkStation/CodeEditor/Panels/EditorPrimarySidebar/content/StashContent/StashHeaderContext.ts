import { createContext } from "react";

import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";

/** Navigation and actions supplied by the sidebar hosting the stash list. */
export const StashHeaderContext = createContext<{
  onBack: () => void;
  actions: SectionHeaderAction[];
} | null>(null);
