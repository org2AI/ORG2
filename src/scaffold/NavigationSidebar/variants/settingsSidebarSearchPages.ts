import type {
  SettingsNavigationGroup,
  SettingsNavigationItem,
  SettingsNavigationItemId,
} from "@src/config/settingsNavigation";
import type { GlobalSettingsSearchGroup } from "@src/config/settingsSearch";
import type { buildSettingsSetupActions } from "@src/config/settingsSetupActions";
import type { RenderedSettingsControl } from "@src/modules/shared/layouts/blocks/SettingsSearchDropdown/settingsControlSearch";

export interface SettingsControlSearchItem {
  readonly kind: "control";
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly targetId?: string;
  readonly searchKey?: string;
  readonly searchTerms?: readonly string[];
}

interface SettingsActionSearchItem {
  readonly kind: "action";
  readonly id: string;
  readonly label: string;
  readonly navigationItem: SettingsNavigationItem;
  readonly searchTerms: readonly string[];
}

interface SettingsPageSearchItem {
  readonly kind: "navigation";
  readonly id: string;
  readonly label: string;
  readonly navigationItem: SettingsNavigationItem;
}

export type SettingsSidebarSearchItem =
  | SettingsControlSearchItem
  | SettingsPageSearchItem
  | SettingsActionSearchItem;

export interface SettingsSidebarSearchPage {
  readonly page: SettingsPageSearchItem;
  readonly items: readonly SettingsSidebarSearchItem[];
}

/** Consolidate destinations, schema controls and the current page's extra rows. */
export function buildSettingsSidebarSearchPages(
  navigationGroups: readonly SettingsNavigationGroup[],
  catalog: readonly GlobalSettingsSearchGroup[],
  renderedControls: readonly RenderedSettingsControl[],
  activeItemId: SettingsNavigationItemId,
  currentPath: string,
  actions: ReturnType<typeof buildSettingsSetupActions> = []
): SettingsSidebarSearchPage[] {
  const controlsByPage = new Map<string, SettingsControlSearchItem[]>();
  const schemaKeys = new Set<string>();
  for (const group of catalog) {
    for (const item of group.items) {
      schemaKeys.add(item.key);
      const controls = controlsByPage.get(item.navigationItem.id) ?? [];
      controls.push({
        kind: "control",
        id: item.id,
        label: item.label,
        path: item.path,
        searchKey: item.key,
        searchTerms: item.searchTerms,
      });
      controlsByPage.set(item.navigationItem.id, controls);
    }
  }

  const currentControls = controlsByPage.get(activeItemId) ?? [];
  for (const control of renderedControls) {
    // A schema key owns its canonical destination, even when it is mounted.
    if (control.searchKeys.some((key) => schemaKeys.has(key))) continue;
    currentControls.push({
      kind: "control",
      id: control.targetId,
      label: control.label,
      path: currentPath,
      targetId: control.targetId,
      searchTerms: control.description ? [control.description] : undefined,
    });
  }
  controlsByPage.set(activeItemId, currentControls);

  return navigationGroups.flatMap((group) =>
    group.items.map((navigationItem) => {
      const page: SettingsPageSearchItem = {
        kind: "navigation",
        id: navigationItem.id,
        label: navigationItem.label,
        navigationItem,
      };
      return {
        page,
        items: [
          page,
          ...actions
            .filter((action) => action.pageId === page.id)
            .map(
              (action): SettingsActionSearchItem => ({
                kind: "action",
                id: `setup-${action.id}`,
                label: action.label,
                searchTerms: action.searchTerms,
                navigationItem: { ...navigationItem, path: action.path },
              })
            ),
          ...(controlsByPage.get(page.id) ?? []),
        ],
      };
    })
  );
}
