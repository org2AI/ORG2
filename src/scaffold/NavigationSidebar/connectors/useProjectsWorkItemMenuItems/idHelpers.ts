import { PROJECTS_PROJECT_OVERVIEW_PREFIX } from "./constants";

export function getProjectOverviewMenuItemId(projectSlug: string): string {
  return `${PROJECTS_PROJECT_OVERVIEW_PREFIX}${projectSlug}`;
}

export function getProjectsProjectOverviewSlug(
  menuItemId: string
): string | null {
  if (!menuItemId.startsWith(PROJECTS_PROJECT_OVERVIEW_PREFIX)) return null;
  return menuItemId.slice(PROJECTS_PROJECT_OVERVIEW_PREFIX.length) || null;
}
