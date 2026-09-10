import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { NavigationMenuItem } from "../components/NavigationMenu/config";
import NavigationSidebar from "./NavigationSidebar";

vi.mock("../SidebarBase", () => ({
  default: ({
    children,
    includeTrafficLightSpace,
  }: {
    children?: ReactNode;
    includeTrafficLightSpace?: boolean;
  }) =>
    createElement(
      "aside",
      {
        "data-include-traffic-light-space": String(includeTrafficLightSpace),
      },
      children
    ),
}));

vi.mock("../components/NavigationMenu", () => ({
  default: ({ items }: { items: readonly NavigationMenuItem[] }) =>
    createElement(
      "div",
      null,
      items.map((item) =>
        createElement(
          "span",
          { key: item.key, "data-test-menu-item": item.id },
          item.label
        )
      )
    ),
}));

describe("NavigationSidebar", () => {
  it("renders separators in pinned items as standard section headers", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationSidebar, {
        menuItems: [],
        pinnedMenuItems: [
          { id: "create", key: "create", label: "Create" },
          {
            id: "separator-work-items-browse",
            key: "separator-work-items-browse",
            label: "Browse",
          },
          { id: "projects", key: "projects", label: "Projects" },
        ],
      })
    );

    expect(markup).toContain(
      'class="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium tracking-wider text-text-2 uppercase"'
    );
    expect(markup).toContain('<span class="min-w-0 truncate">Browse</span>');
    expect(markup).toContain('class="flex flex-col gap-2 px-3 pt-1"');
    expect(markup).toContain('data-sidebar-section-id="work-items-browse"');
    expect(markup).not.toContain(
      'data-test-menu-item="separator-work-items-browse"'
    );
  });

  it("allows titled pinned sections to be collapsed", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationSidebar, {
        menuItems: [],
        pinnedMenuItems: [
          { id: "create", key: "create", label: "Create" },
          {
            id: "separator-work-items-browse",
            key: "separator-work-items-browse",
            label: "Browse",
          },
          { id: "projects", key: "projects", label: "Projects" },
        ],
        collapsibleSections: true,
        collapsedSectionIds: new Set(["work-items-browse"]),
        onCollapsedSectionsChange: vi.fn(),
      })
    );

    expect(markup).toContain('data-sidebar-section-toggle="work-items-browse"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-test-menu-item="create"');
    expect(markup).not.toContain('data-test-menu-item="projects"');
  });

  it("renders actions on an existing session section header", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationSidebar, {
        menuItems: [
          {
            id: "separator-today",
            key: "separator-today",
            label: "Today",
            rowActions: [
              {
                label: "More",
                dataTestId: "section-more",
                onClick: vi.fn(),
              },
              {
                label: "Search sessions",
                showOnSidebarHover: true,
                dataTestId: "sidebar-sessions-search",
                onClick: vi.fn(),
              },
              {
                label: "Refresh",
                showOnSidebarHover: true,
                dataTestId: "sidebar-sessions-refresh",
                onClick: vi.fn(),
              },
            ],
          },
          { id: "session-1", key: "session-1", label: "First session" },
        ],
        collapsibleSections: true,
      })
    );

    expect(markup).toContain('data-sidebar-section-toggle="today"');
    expect(markup).toContain(">Today</span>");
    expect(markup).toContain('data-testid="sidebar-sessions-search"');
    expect(markup).toContain('title="Search sessions"');
    expect(markup).toContain('data-testid="sidebar-sessions-refresh"');
    expect(markup).toContain('title="Refresh"');
    expect(markup).toContain(
      '<span class="hidden group-hover/section-title:inline-flex group-focus-visible/section-title:inline-flex group-has-[:focus-visible]/section-title:inline-flex"><button type="button" aria-label="More"'
    );
    expect(markup.indexOf('data-testid="section-more"')).toBeLessThan(
      markup.indexOf('data-testid="sidebar-sessions-search"')
    );
    expect(markup.match(/group-hover\/sidebar:inline-flex/g)).toHaveLength(2);
    expect(
      markup.indexOf('data-testid="sidebar-sessions-search"')
    ).toBeLessThan(markup.indexOf('data-testid="sidebar-sessions-refresh"'));
  });

  it("keeps every header action visible when the filter is active outside sidebar hover", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationSidebar, {
        menuItems: [
          {
            id: "separator-team",
            key: "separator-team",
            label: "Team",
            rowActions: ["Search", "Refresh", "Filter"].map((label) => ({
              label,
              active: label === "Filter",
              showOnSidebarHover: true,
              onClick: vi.fn(),
            })),
          },
        ],
        collapsibleSections: true,
      })
    );
    for (const label of ["Search", "Refresh", "Filter"]) {
      expect(markup).toContain(
        `<span class="inline-flex"><button type="button" aria-label="${label}"`
      );
    }
    expect(markup).not.toContain("group-hover/sidebar:inline-flex");
  });

  it("renders the standard loading state without dummy rows", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationSidebar, {
        menuItems: [],
        isLoading: true,
      })
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("animate-pulse");
  });

  it("lets browser-hosted sidebars remove native window chrome spacing", () => {
    const markup = renderToStaticMarkup(
      createElement(NavigationSidebar, {
        menuItems: [],
        includeTrafficLightSpace: false,
      })
    );

    expect(markup).toContain('data-include-traffic-light-space="false"');
  });
});
