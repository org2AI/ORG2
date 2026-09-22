// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GitHubIssueTimelineItem } from "@src/api/tauri/github";

import { IssueTimelineItems } from "../IssueTimelineItems";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; reason?: string }) =>
      options?.reason
        ? `Unable to load activity: ${options.reason}`
        : (options?.defaultValue ?? ""),
  }),
}));

function timelineItem(
  overrides: Partial<GitHubIssueTimelineItem>
): GitHubIssueTimelineItem {
  return {
    id: 1,
    event: "labeled",
    created_at: "2026-09-13T02:34:00Z",
    actor: { login: "ShiboSheng", avatar_url: "" },
    body: null,
    html_url: null,
    assignee: null,
    label: { name: "bug", color: "d73a4a" },
    milestone: null,
    rename: null,
    source: null,
    commit_id: null,
    lock_reason: null,
    ...overrides,
  };
}

describe("IssueTimelineItems", () => {
  it("yields to the host alert instead of burying the failure in the thread", () => {
    // The reason a thread is empty belongs above the title, not at the end of
    // the activity list where it reads as just another event.
    const markup = renderToStaticMarkup(
      React.createElement(IssueTimelineItems, {
        timeline: [],
        timelineLoading: false,
        timelineError: "github_rate_limited",
      })
    );

    expect(markup).toBe("");
  });

  it("still shows the loading state while the request is running", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IssueTimelineItems, {
        timeline: [],
        timelineLoading: true,
        timelineError: "github_rate_limited",
      })
    );

    expect(markup).not.toBe("");
  });

  it("collapses close-together same-actor label events into one row", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IssueTimelineItems, {
        timeline: [
          timelineItem({
            id: 1,
            created_at: "2026-09-13T02:34:05Z",
            label: { name: "bug", color: "d73a4a" },
          }),
          timelineItem({
            id: 2,
            created_at: "2026-09-13T02:34:22Z",
            label: { name: "UX", color: "8b2fc9" },
          }),
          timelineItem({
            id: 3,
            event: "assigned",
            created_at: "2026-09-14T11:23:00Z",
            label: null,
            assignee: { login: "Harry19081", avatar_url: "" },
          }),
        ],
        timelineLoading: false,
      })
    );

    const container = document.createElement("div");
    container.innerHTML = markup;

    // Two rows (the collapsed label group, and the separate, different-day
    // assignment) means one connector between them.
    expect(
      container.querySelectorAll('[data-testid="timeline-connector"]')
    ).toHaveLength(1);
    // The label icon renders once per row, not once per grouped event.
    expect(container.querySelectorAll('[data-icon="tag-icon"]')).toHaveLength(
      1
    );
    expect(container.textContent).toContain("bug");
    expect(container.textContent).toContain("UX");
    // Once for the collapsed label-group row's actor, once for the separate
    // assignment row's actor — never three times for the three raw events.
    expect(container.textContent?.match(/ShiboSheng/g)?.length).toBe(2);
  });
});
