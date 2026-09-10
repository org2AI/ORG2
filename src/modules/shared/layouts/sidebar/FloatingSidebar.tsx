/** Hover presentation retains its visibility context around the shared route body. */
import React from "react";

import { ForceVisibleSidebarProvider } from "@src/scaffold/NavigationSidebar/contexts/ForceVisibleContext";

import { useRouteLayoutType } from "../../hooks";
import { RouteSidebarBody } from "./RouteSidebarBody";

export const FloatingSidebar: React.FC = React.memo(() => {
  const layoutType = useRouteLayoutType();
  if (layoutType === "standard") return null;

  return (
    <ForceVisibleSidebarProvider>
      <RouteSidebarBody layoutType={layoutType} />
    </ForceVisibleSidebarProvider>
  );
});

FloatingSidebar.displayName = "FloatingSidebar";
