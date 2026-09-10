/** Hover sidebars remain visible while the docked sidebar is collapsed. */
import { type ReactNode, createContext, useContext } from "react";

const ForceVisibleSidebarContext = createContext(false);

export function useForceVisibleSidebar(): boolean {
  return useContext(ForceVisibleSidebarContext);
}

export function ForceVisibleSidebarProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ForceVisibleSidebarContext.Provider value={true}>
      {children}
    </ForceVisibleSidebarContext.Provider>
  );
}
