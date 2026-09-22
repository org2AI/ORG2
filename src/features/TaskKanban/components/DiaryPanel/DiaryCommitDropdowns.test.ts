// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { expect, it, vi } from "vitest";

import { dismissHoverCard } from "@src/components/HoverCard/singletonStore";
import PrHoverCard from "@src/components/PrHoverCard";

import { DiaryCommitDetailsDropdown } from "./DiaryCommitDropdowns";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

it("replaces a PR preview with commit metadata and dismisses on commit action", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = vi.fn();
  const person = {
    name: "Author",
    email: "author@example.com",
    date: "2026-09-13T00:00:00Z",
  };
  try {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          jsx(PrHoverCard, {
            pr: { number: 1, title: "Pull request", state: "open" },
            children: createElement("button", { id: "pr" }, "PR"),
          }),
          jsx(DiaryCommitDetailsDropdown, {
            marker: {
              id: "commit",
              timestamp: new Date(person.date),
              task: undefined,
              sessionId: undefined,
              commit: {
                sha: "abc123456789",
                short_sha: "abc1234",
                summary: "Commit summary",
                body: "",
                author: person,
                committer: person,
                parent_shas: [],
              },
            },
            children: createElement(
              "button",
              { id: "commit", onClick: click },
              "Commit"
            ),
          })
        )
      )
    );
    const hover = (id: string) =>
      act(() => {
        container
          .querySelector(`#${id}`)!
          .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        vi.advanceTimersByTime(500);
      });
    expect(document.querySelector("[data-hover-card]")).toBeNull();
    hover("pr");
    expect(document.querySelector("[data-hover-card]")?.textContent).toContain(
      "Pull request"
    );
    hover("commit");
    expect(document.querySelectorAll("[data-hover-card]")).toHaveLength(1);
    const text = document.querySelector("[data-hover-card]")?.textContent;
    expect(text).toContain("Commit summary");
    expect(text).toContain("abc1234");
    expect(text).toContain("Author");
    expect(text).not.toContain("Pull request");
    act(() =>
      container
        .querySelector("#commit")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-hover-card]")).toBeNull();
  } finally {
    act(() => root.unmount());
    dismissHoverCard();
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
