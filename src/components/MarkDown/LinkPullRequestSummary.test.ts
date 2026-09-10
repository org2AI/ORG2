import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  createGitHubPrTabDataFromLink,
  getPrAuthor,
} from "./LinkHoverCard.helpers";
import LinkPullRequestSummary from "./LinkPullRequestSummary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
const url = "https://github.com/org/repo/pull/42";
const pullRequest = { owner: "org", repo: "repo", number: 42 };
const detail = {
  title: "Improve previews",
  state: "open",
  updated_at: "2026-09-06T00:00:00Z",
  user: {
    login: "alice",
    avatar_url: "https://avatars.githubusercontent.com/u/1",
  },
  head: { ref: "feature" },
  base: { ref: "main" },
  additions: 12,
  deletions: 3,
};
const data = createGitHubPrTabDataFromLink({ url, repoPath: "", detail });
function render(loading: boolean) {
  return renderToStaticMarkup(
    createElement(LinkPullRequestSummary, {
      pullRequest,
      data: loading ? null : data,
      author: loading ? null : getPrAuthor(detail),
      loading,
      filesChanged: 3,
    })
  );
}
describe("PR summary", () => {
  it("keeps the same row heights while loading without a loading label or URL", () => {
    const loading = render(true);
    const loaded = render(false);
    const heights = (html: string) => html.match(/flex h-6 items-center/g);
    expect(heights(loading)).toEqual(heights(loaded));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("bg-fill-2");
    expect(loading).not.toContain("Loading");
    expect(loaded).not.toContain(url);
  });
  it("renders author, avatar, file count, diff counts and a rounded pill with a larger icon", () => {
    const html = render(false);
    for (const value of [
      "Improve previews",
      "alice",
      detail.user.avatar_url,
      "cards.url.changesCount",
      "+12",
      "-3",
      "tag-pill",
    ])
      expect(html).toContain(value);
    expect(html).toContain('width="14"');
    expect(html).toContain("tag-size-mini");
    expect(html).toContain(detail.updated_at);
    expect(html).toContain("break-words");
    expect(html.indexOf("tag-pill")).toBeLessThan(
      html.indexOf("Improve previews")
    );
  });
  it("does not manufacture author metadata when GitHub omits it", () => {
    expect(getPrAuthor({ user: null })).toEqual({
      login: undefined,
      avatarUrl: undefined,
    });
  });
});
