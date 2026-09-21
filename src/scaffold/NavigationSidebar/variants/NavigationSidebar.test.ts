// @vitest-environment jsdom
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  SIDEBAR_SECTION_LABEL_CLASS,
  SIDEBAR_SECTION_LABEL_ROW_CLASS,
} from "../blocks/SidebarSectionLabel";
import type { NavigationMenuItem } from "../components/NavigationMenu/config";
import NavigationSidebar from "./NavigationSidebar";

vi.mock("../SidebarBase", () => ({
  default: ({ children }: { children?: ReactNode }) =>
    createElement("aside", null, children),
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

    // A separator renders the shared sidebar section label, the same block the
    // settings sidebar uses — so both sidebars stay one family by construction.
    expect(markup).toContain(`class="${SIDEBAR_SECTION_LABEL_ROW_CLASS}"`);
    expect(markup).toContain(
      `<span class="${SIDEBAR_SECTION_LABEL_CLASS}">Browse</span>`
    );
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
    const rendered = new DOMParser().parseFromString(markup, "text/html");
    const moreAction = rendered.querySelector('[data-testid="section-more"]');
    expect(moreAction?.getAttribute("aria-label")).toBe("More");
    expect(moreAction?.parentElement?.className).toBe(
      "hidden group-hover/section-title:inline-flex group-focus-visible/section-title:inline-flex group-has-[:focus-visible]/section-title:inline-flex"
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
    const rendered = new DOMParser().parseFromString(markup, "text/html");
    for (const label of ["Search", "Refresh", "Filter"]) {
      const action = rendered.querySelector(`button[aria-label="${label}"]`);
      expect(action).not.toBeNull();
      expect(action?.parentElement?.className).toBe("inline-flex");
    }
    expect(markup).not.toContain("group-hover/sidebar:inline-flex");
  });

  it("renders pinned and list sections through the same section block", () => {
    // The pinned strip and the scrolling list used to be two copies of the
    // section markup and had already drifted apart. Both now render
    // NavigationSidebarSection, so a titled section produces identical markup
    // in either place — this is the invariant that makes the single copy safe.
    const section = [
      {
        id: "separator-today",
        key: "separator-today",
        label: "Today",
      },
      { id: "alpha", key: "alpha", label: "Alpha" },
    ];
    const render = (placement: "pinned" | "list") =>
      renderToStaticMarkup(
        createElement(NavigationSidebar, {
          menuItems: placement === "list" ? section : [],
          pinnedMenuItems: placement === "pinned" ? section : [],
          collapsibleSections: true,
        })
      );

    const extract = (markup: string) =>
      markup.slice(
        markup.indexOf('<div data-sidebar-section-id="today"'),
        markup.indexOf('data-test-menu-item="alpha"')
      );

    const pinned = extract(render("pinned"));
    expect(pinned).toContain('data-sidebar-section-toggle="today"');
    expect(pinned).toBe(extract(render("list")));
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
});
