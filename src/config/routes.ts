/**
 * Centralized Route Constants
 *
 * Single source of truth for all application routes.
 * Each route includes:
 * - path: The actual route path
 * - label: Display label (static or dynamic)
 * - icon: Icon name for this route
 *
 * Structure:
 * - /orgii/workstation/*   - Workbench surfaces
 * - /orgii/app/settings/*  - Settings inside the Workbench shell
 * - /orgii/app/*           - Standalone application pages
 */
import type { IconSvgElement } from "@src/icons";

import { ICON_NAME_MAP } from "./iconMapping";
// Route group constants — imported for use below and re-exported for consumers
import {
  APP_AGENT_ORGS_ROUTE,
  APP_SETTINGS_ROUTE,
  APP_STATION_WINDOW_ROUTE,
  AUTH_ROUTES,
  MOBILE_REMOTE_ROUTE,
  WORK_STATION_ROUTES,
} from "./routeGroups";
// Shared route-display metadata stays independent from router state.
import type { RouteInfo, RouteLabelContext } from "./routeTypes";

// Re-export for convenience
export type { RouteLabelContext, RouteInfo };

export {
  APP_AGENT_ORGS_ROUTE,
  APP_SETTINGS_ROUTE,
  APP_STATION_WINDOW_ROUTE,
  AUTH_ROUTES,
  MOBILE_REMOTE_ROUTE,
  WORK_STATION_ROUTES,
};

// ============================================================================
// UNIFIED ROUTE OBJECT
// All routes in one place for easy access
// ============================================================================

export const ROUTES = {
  workStation: WORK_STATION_ROUTES,
  auth: AUTH_ROUTES,
  app: {
    agentOrgs: APP_AGENT_ORGS_ROUTE,
    settings: APP_SETTINGS_ROUTE,
    stationWindow: APP_STATION_WINDOW_ROUTE,
  },
} as const;

// ============================================================================
// ROUTE LOOKUP HELPERS
// ============================================================================

/**
 * Get label from a RouteInfo, resolving dynamic labels
 */
export function getRouteLabel(
  routeInfo: RouteInfo,
  context: RouteLabelContext = {}
): string {
  if (typeof routeInfo.label === "function") {
    return routeInfo.label(context);
  }
  return routeInfo.label;
}

/**
 * Collect all static RouteInfo objects for lookup
 * (Excludes function-based dynamic routes like workspaceWithId)
 */
function collectAllRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Helper to recursively collect routes
  function collect(obj: Record<string, unknown>) {
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object" && "path" in value) {
        routes.push(value as RouteInfo);
      } else if (value && typeof value === "object" && !("path" in value)) {
        // Nested object, recurse (but skip functions)
        if (typeof value !== "function") {
          collect(value as Record<string, unknown>);
        }
      }
    }
  }

  collect(ROUTES);
  return routes;
}

/** All static routes for lookup */
export const ALL_ROUTES = collectAllRoutes();

/**
 * Find route info by path
 */
export function findRouteByPath(path: string): RouteInfo | undefined {
  // Exact match first
  const exact = ALL_ROUTES.find((route) => route.path === path);
  if (exact) return exact;

  // Pattern match (for :param routes)
  for (const routeInfo of ALL_ROUTES) {
    if (matchRoutePath(path, routeInfo.path)) {
      return routeInfo;
    }
  }

  return undefined;
}

/**
 * Match a path against a pattern (supports :param)
 */
export function matchRoutePath(path: string, pattern: string): boolean {
  if (path === pattern) return true;

  const patternParts = pattern.split("/");
  const pathParts = path.split("/");

  if (patternParts.length !== pathParts.length) return false;

  for (let index = 0; index < patternParts.length; index++) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];

    if (patternPart.startsWith(":")) continue;
    if (patternPart !== pathPart) return false;
  }

  return true;
}

/**
 * Get label for a path (with optional context for dynamic labels)
 */
export function getLabelForPath(
  path: string,
  context: RouteLabelContext = {}
): string {
  const routeInfo = findRouteByPath(path);
  if (!routeInfo) return "Unknown";
  return getRouteLabel(routeInfo, context);
}

/**
 * Get icon name for a path
 */
export function getIconForPath(path: string): string | undefined {
  const routeInfo = findRouteByPath(path);
  return routeInfo?.icon;
}

/**
 * Get icon component for a path
 */
export function getIconComponentForPath(path: string): IconSvgElement | null {
  const iconName = getIconForPath(path);
  if (!iconName) return null;
  return ICON_NAME_MAP[iconName] ?? null;
}

function isWithinRoute(pathname: string, routePath: string): boolean {
  return pathname === routePath || pathname.startsWith(`${routePath}/`);
}

/** Whether a pathname is the detached station window page. */
export function isStationWindowPath(pathname: string): boolean {
  return isWithinRoute(pathname, ROUTES.app.stationWindow.path);
}

/** Whether a pathname is owned by the Settings surface. */
export function isSettingsPath(pathname: string): boolean {
  return isWithinRoute(pathname, ROUTES.app.settings.path);
}

/**
 * Whether a pathname is owned by a Workbench surface: the persistent
 * Workbench shell, or a detached station window, which renders the same
 * workstation surface on its own and takes the same tab / palette shortcuts.
 */
export function isWorkbenchPath(pathname: string): boolean {
  return (
    isWithinRoute(pathname, ROUTES.workStation.base.path) ||
    isSettingsPath(pathname) ||
    isStationWindowPath(pathname)
  );
}
