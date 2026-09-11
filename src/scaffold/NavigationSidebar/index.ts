/** Shared application sidebar surface, menus, and route bodies. */
export { default as SidebarBase } from "./SidebarBase";

export { default as HoverSidebar } from "./HoverSidebar";

// =====================================
export { default as NavigationMenu } from "./components/NavigationMenu";
export type { NavigationMenuItem } from "./components/NavigationMenu/config";

export {
  useForceVisibleSidebar,
  ForceVisibleSidebarProvider,
} from "./contexts/ForceVisibleContext";

export { SIDEBAR_STYLE, SIDEBAR_PADDING } from "./config";
