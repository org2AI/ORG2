/** One route-to-body mapping shared by docked and hover sidebars. */
import type { LayoutType } from "@src/modules/hooks/useRouteLayoutType";
import { WorkstationSidebarConnector } from "@src/scaffold/NavigationSidebar/connectors";
import SettingsSidebar from "@src/scaffold/NavigationSidebar/variants/SettingsSidebar";

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
