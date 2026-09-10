/**
 * Route preloading — extracted from pages.tsx to avoid circular dependencies.
 *
 * This module uses only dynamic import() expressions (no static imports from
 * the app module graph), so it is safe to import from NavigationMenu, TabItem,
 * AppShell, etc. without creating cycles.
 */

type RouteLoader = () => Promise<unknown>;

const loadAgentOrgs: RouteLoader = () =>
  import("@src/modules/MainApp/AgentOrgs");
const loadMyRole: RouteLoader = () => import("@src/modules/MainApp/MyRole");
const loadSettingsSlot: RouteLoader = () =>
  import("@src/modules/MainApp/Settings/SettingsSlot");

// These are the only route chunks warmed by navigation. Key by loader identity,
// not the unbounded set of URLs that can address the same Settings surface.
const settingsLoaders = [loadSettingsSlot, loadAgentOrgs, loadMyRole];
const preloaded = new Map<RouteLoader, Promise<unknown>>();

export function preloadRouteByPath(routePath: string): void {
  const pathname = routePath.split(/[?#]/, 1)[0];
  if (
    pathname !== "/orgii/app/settings" &&
    !pathname.startsWith("/orgii/app/settings/")
  )
    return;
  for (const loader of settingsLoaders) {
    if (preloaded.has(loader)) continue;
    const pending = loader().catch(() => {
      preloaded.delete(loader);
    });
    preloaded.set(loader, pending);
  }
}
