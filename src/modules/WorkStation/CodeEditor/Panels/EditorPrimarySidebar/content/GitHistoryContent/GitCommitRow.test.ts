// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import GitCommitRow, {
  GIT_COMMIT_ROW_HEIGHT,
  GIT_COMMIT_ROW_PITCH,
} from "./GitCommitRow";

it("preserves fixed graph geometry, selection and context-menu callbacks through the shared row", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const person = { name: "Ada", email: "a@example.com", date: "2026-09-13" };
  const commit = {
    body: "",
    author: person,
    committer: person,
    parent_shas: [],
    sha: "abc123",
    short_sha: "abc",
    summary: "Shared row",
  };
  const select = vi.fn();
  const menu = vi.fn();
  try {
    await act(async () =>
      root.render(
        React.createElement(GitCommitRow, {
          commit,
          isSelected: true,
          onSelect: select,
          onContextMenu: menu,
          svgWidth: 16,
          graphNode: {
            commit,
            activeLaneCount: 1,
            lane: 0,
            color: "red",
            lines: [
              { fromLane: 0, toLane: 0, segment: "bottom", color: "red" },
            ],
          },
        })
      )
    );
    const button = host.querySelector("button")!;
    expect(button.style.height).toBe(`${GIT_COMMIT_ROW_HEIGHT}px`);
    expect(button.querySelector("svg")!.getAttribute("height")).toBe(
      String(GIT_COMMIT_ROW_PITCH)
    );
    expect(GIT_COMMIT_ROW_PITCH).toBe(GIT_COMMIT_ROW_HEIGHT + 1);
    expect(button.parentElement!.classList.contains("pb-px")).toBe(true);
    expect(button.querySelector("line")!.getAttribute("y2")).toBe(
      String(GIT_COMMIT_ROW_PITCH)
    );
    expect(button.querySelector("circle")!.getAttribute("cy")).toBe(
      String(GIT_COMMIT_ROW_HEIGHT / 2)
    );
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Shared row");
    await act(async () => button.click());
    expect(select).toHaveBeenCalledWith(commit);
    await act(async () =>
      button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    );
    expect(menu).toHaveBeenCalledWith(expect.anything(), commit);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
