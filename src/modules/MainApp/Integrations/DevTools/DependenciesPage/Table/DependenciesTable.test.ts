import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DependenciesTable from "./DependenciesTable";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/components/SettingsTable", () => ({
  default: ({
    searchBar,
  }: {
    searchBar: { tabPills: React.ReactNode; rightContent?: React.ReactNode };
  }) => createElement("div", null, searchBar.tabPills, searchBar.rightContent),
  SETTINGS_TABLE_CELL: {},
  SETTINGS_TABLE_COL: {},
}));

vi.mock("@/src/components/TabPill", () => ({
  default: ({ tabs }: { tabs: { key: string; label: string }[] }) =>
    createElement(
      "div",
      null,
      tabs.map((tab) => createElement("button", { key: tab.key }, tab.label))
    ),
}));

describe("DependenciesTable category filters", () => {
  it("shows an icon-only refresh action and disables it during scans", () => {
    const render = (loading: boolean, refreshing: boolean) =>
      renderToStaticMarkup(
        createElement(DependenciesTable, {
          dependencies: [],
          loading,
          refreshing,
          onRefresh: vi.fn(),
        })
      );
    const ready = render(false, false);
    expect(ready).toContain('data-testid="dependencies-refresh"');
    expect(ready).toContain('aria-label="actions.refresh"');
    expect(ready).toContain('data-icon="refresh-cw"');
    expect(ready).not.toContain('disabled=""');
    expect(render(true, false)).toContain('disabled=""');
    expect(render(false, true)).toContain('disabled=""');
  });

  it("shows every supported category before rows load and keeps them after loading", () => {
    const pending = renderToStaticMarkup(
      createElement(DependenciesTable, {
        dependencies: [],
        loading: true,
      })
    );
    for (const category of [
      "PackageManager",
      "Runtime",
      "VersionControl",
      "Toolchain",
      "ShellUtility",
    ]) {
      expect(pending).toContain(`dependencies.category${category}`);
    }
    expect(pending).not.toContain("dependencies.categoryDatabase");
    const loaded = renderToStaticMarkup(
      createElement(DependenciesTable, {
        dependencies: [
          {
            name: "Node",
            binary: "node",
            installed: true,
            version: "22",
            category: "runtime",
          },
        ],
        loading: false,
      })
    );
    expect(loaded).toBe(pending);
  });
});
