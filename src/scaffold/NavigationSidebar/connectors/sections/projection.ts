import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session } from "@src/store/session";

export const sectionGroupId = (id: string) => `custom-section-${id}`;

/** Pin wins visually while membership stays intact for unpin. One pass over rows. */
export function buildCustomSectionItems(
  sessions: readonly Session[],
  headers: readonly NavigationMenuItem[],
  membership: ReadonlyMap<string, string>,
  buildRow: (session: Session) => NavigationMenuItem,
  pager: (id: string) => NavigationMenuItem | null
): NavigationMenuItem[] {
  const buckets = new Map<string, NavigationMenuItem[]>();
  for (const session of sessions) {
    const section = membership.get(session.session_id);
    if (!section || session.pinned) continue;
    const rows = buckets.get(section) ?? [];
    rows.push(buildRow(session));
    buckets.set(section, rows);
  }
  return headers.flatMap((header) => {
    const id = header.id.slice("separator-custom-section-".length);
    const more = pager(id);
    return [header, ...(buckets.get(id) ?? []), ...(more ? [more] : [])];
  });
}
