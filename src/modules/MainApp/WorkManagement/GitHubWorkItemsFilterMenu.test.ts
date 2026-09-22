// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GitHubWorkItemsFilterMenu,
  type GitHubWorkItemsFilterMenuProps,
  GitHubWorkItemsFilterPanel,
} from "./GitHubWorkItemsFilterMenu";
import {
  EMPTY_GITHUB_WORK_ITEM_FACETS,
  type GitHubWorkItemFacets,
} from "./githubWorkItemsFilterFacets";
import {
  type ParsedGitHubSearchQuery,
  parseGitHubSearchQuery,
  serializeGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";

const issueFacets: GitHubWorkItemFacets = {
  ...EMPTY_GITHUB_WORK_ITEM_FACETS,
  authors: [
    { value: "alice", count: 3 },
    { value: "bob", count: 1 },
  ],
  labels: [{ value: "bug", count: 2 }],
};

function menuProps(
  rawQuery: string,
  overrides: Partial<GitHubWorkItemsFilterMenuProps> = {}
): GitHubWorkItemsFilterMenuProps {
  return {
    scope: "issue",
    facets: issueFacets,
    parsedSearchQuery: parseGitHubSearchQuery(rawQuery),
    updateSearchQuery: vi.fn(),
    ...overrides,
  };
}

describe("GitHubWorkItemsFilterMenu trigger", () => {
  it("renders Filter as a tertiary icon-only header button without a tooltip", () => {
    const markup = renderToStaticMarkup(
      createElement(
        GitHubWorkItemsFilterMenu,
        menuProps("is:issue author:@me -label:wip")
      )
    );

    expect(markup).toContain('data-icon="funnel"');
    expect(markup).toContain('aria-label="actions.filter (2)"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("bg-fill-1! text-primary-6!");
    expect(markup).not.toContain("data-tooltip-label");
    expect(markup).toContain("height:28px");
  });

  it("keeps Filter unhighlighted when only scope, state, and text are set", () => {
    const markup = renderToStaticMarkup(
      createElement(
        GitHubWorkItemsFilterMenu,
        menuProps("is:issue is:open crash")
      )
    );

    expect(markup).toContain('aria-label="actions.filter"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain("bg-fill-1! text-primary-6!");
  });
});

describe("GitHubWorkItemsFilterPanel", () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previousActEnvironment: boolean | undefined;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (previousActEnvironment === undefined) {
      Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
    } else {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  async function renderPanel(props: GitHubWorkItemsFilterMenuProps) {
    await act(async () =>
      root.render(createElement(GitHubWorkItemsFilterPanel, props))
    );
  }

  /** Runs the mutation the panel handed to `updateSearchQuery`. */
  function applyLastUpdate(
    props: GitHubWorkItemsFilterMenuProps,
    rawQuery: string
  ): string {
    const calls = vi.mocked(props.updateSearchQuery).mock.calls;
    const mutate = calls[calls.length - 1][0] as (
      query: ParsedGitHubSearchQuery
    ) => void;
    const query = parseGitHubSearchQuery(rawQuery);
    mutate(query);
    return serializeGitHubSearchQuery(query);
  }

  function rowTexts(): string[] {
    return [...container.querySelectorAll('[role="option"]')].map(
      (row) => row.textContent ?? ""
    );
  }

  it("lists the scope's quick filters and opens only sections in use", async () => {
    await renderPanel(menuProps("is:issue is:open author:alice"));

    const texts = rowTexts();
    expect(texts).toContain("chat.panels.manageIssues.createdByMe");
    expect(texts).toContain("chat.panels.manageIssues.filters.noAssignee");
    expect(texts).not.toContain("chat.panels.manageIssues.filters.draft");
    expect(texts).toContain("alice3");
    expect(texts).not.toContain("bug2");

    const selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toBe("alice3");
  });

  it("rewrites the query from quick filters, facet rows, and Clear", async () => {
    const rawQuery = "is:issue is:open author:alice crash";
    const props = menuProps(rawQuery);
    await renderPanel(props);

    await act(async () =>
      container
        .querySelector<HTMLElement>(
          '[data-testid="github-work-items-quick-filter-noAssignee"]'
        )
        ?.click()
    );
    expect(applyLastUpdate(props, rawQuery)).toBe(
      "is:issue is:open author:alice no:assignee crash"
    );

    const bob = [
      ...container.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((row) => row.textContent === "bob1");
    await act(async () => bob?.click());
    expect(applyLastUpdate(props, rawQuery)).toBe(
      "is:issue is:open author:alice author:bob crash"
    );

    await act(async () =>
      container
        .querySelector<HTMLElement>(
          '[data-testid="github-work-items-filter-clear"]'
        )
        ?.click()
    );
    expect(applyLastUpdate(props, rawQuery)).toBe("is:issue is:open crash");
  });

  it("expands a collapsed section on demand", async () => {
    await renderPanel(menuProps("is:issue is:open"));
    expect(rowTexts()).not.toContain("bug2");
    expect(
      container
        .querySelector('[data-testid="github-work-items-filter-clear"]')
        ?.hasAttribute("disabled")
    ).toBe(true);

    const labelHeader = [
      ...container.querySelectorAll<HTMLElement>("[aria-expanded]"),
    ].find((header) =>
      header.textContent?.includes(
        "chat.panels.manageIssues.filters.facetLabel"
      )
    );
    expect(labelHeader?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => labelHeader?.click());

    expect(rowTexts()).toContain("bug2");
  });

  it("shows pull request filters and keeps Clear enabled while one is set", async () => {
    await renderPanel(
      menuProps("is:pr is:open", {
        scope: "pr",
        facets: {
          ...EMPTY_GITHUB_WORK_ITEM_FACETS,
          ciStatuses: [{ value: "failure", count: 4 }],
        },
        parsedSearchQuery: parseGitHubSearchQuery("is:pr status:failure"),
      })
    );

    const texts = rowTexts();
    expect(texts).toContain("chat.panels.manageIssues.filters.draft");
    expect(texts).not.toContain("chat.panels.manageIssues.assignedToMe");
    expect(texts).toContain("chat.panels.manageIssues.filters.ciFailure4");
    expect(
      container
        .querySelector('[data-testid="github-work-items-filter-clear"]')
        ?.hasAttribute("disabled")
    ).toBe(false);
  });
});
