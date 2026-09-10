/** One route-to-body mapping shared by docked and hover sidebars. */
import { WorkstationSidebarConnector } from "@src/scaffold/NavigationSidebar/connectors";
import SettingsSidebar from "@src/scaffold/NavigationSidebar/variants/SettingsSidebar";

import type { LayoutType } from "../../hooks/useRouteLayoutType";

export function RouteSidebarBody({ layoutType }: { layoutType: LayoutType }) {
  switch (layoutType) {
    case "session":
      return <WorkstationSidebarConnector />;
    case "settings":
      return <SettingsSidebar />;
    case "standard":
      return null;
  }
}
