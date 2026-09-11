import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

function getMenuItemSearchText(item: NavigationMenuItem): string {
  return [item.label, item.shortcut]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function filterMenuItem(
  item: NavigationMenuItem,
  normalizedQuery: string
): NavigationMenuItem | null {
  const filteredChildren = item.children
    ?.map((child) => filterMenuItem(child, normalizedQuery))
    .filter((child): child is NavigationMenuItem => Boolean(child));

  if (
    getMenuItemSearchText(item).includes(normalizedQuery) ||
    (filteredChildren && filteredChildren.length > 0)
  ) {
    return filteredChildren ? { ...item, children: filteredChildren } : item;
  }

  return null;
}

export function filterWebSessionMenuItems(
  items: readonly NavigationMenuItem[],
  normalizedQuery: string
): NavigationMenuItem[] {
  if (!normalizedQuery) return [...items];

  const filteredItems: NavigationMenuItem[] = [];
  let pendingSeparator: NavigationMenuItem | null = null;

  for (const item of items) {
    if (item.id?.startsWith("separator-")) {
      pendingSeparator = item;
      continue;
    }

    const filteredItem = filterMenuItem(item, normalizedQuery);
    if (!filteredItem) continue;

    if (pendingSeparator) {
      filteredItems.push(pendingSeparator);
      pendingSeparator = null;
    }
    filteredItems.push(filteredItem);
  }

  return filteredItems;
}
