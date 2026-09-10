// @vitest-environment jsdom
import { openPath } from "@tauri-apps/plugin-opener";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissHoverCard } from "@src/components/SessionHoverCard/singletonStore";

import { SpotlightItemRow } from "./SpotlightItemRow";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Spotlight row detail panes", () => {
  let root: Root;
  let container: HTMLDivElement;
  const select = vi.fn();
  const pane = () =>
    document.querySelector<HTMLElement>("[data-spotlight-detail-pane]");
  const hover = (id: string) => {
    act(() => {
      container
        .querySelector(`[data-spotlight-item-id='${id}']`)!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
  };
  beforeEach(() => {
    vi.mocked(openPath).mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    select.mockClear();
    container = document.createElement("div");
    container.setAttribute("data-spotlight-detail-anchor", "");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          ...[
            {
              id: "repo",
              label: "Repository",
              type: "repo" as const,
              data: { fs_uri: "/work/repo", branch: "main" },
            },
            {
              id: "remote-repo",
              label: "Remote repository",
              type: "repo" as const,
              data: { repo_url: "https://example.com/repo" },
            },
            {
              id: "folders",
              label: "Workspace",
              type: "repo" as const,
              data: {
                detailFolders: [
                  { name: "client", path: "/work/client" },
                  { name: "server", path: "/work/server" },
                ],
                contextMenuCopy: { path: "/work/client" },
              },
            },
            {
              id: "worktree",
              label: "tree",
              type: "option" as const,
              data: {
                worktreePath: "/work/tree",
                branch: "dev/feature",
              },
            },
            {
              id: "branch",
              label: "feature",
              type: "branch" as const,
              desc: "Remote · 19m",
              data: {
                isRemote: true,
                worktreePath: "/work/tree",
                lastCommitDate: "2026-09-07T20:58:01+08:00",
                rightLabel: "19m",
              },
            },
          ].map((item, index) =>
            createElement(SpotlightItemRow, {
              key: item.id,
              item,
              index,
              isSelected: false,
              isKeyboardMode: false,
              onHover: vi.fn(),
              onSelect: select,
              searchQuery: "",
            })
          )
        )
      )
    );
  });
  afterEach(() => {
    act(() => {
      root.unmount();
      dismissHoverCard();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("shows loaded metadata after a delay, with only one pane across rows", () => {
    expect(pane()).toBeNull();
    hover("repo");
    expect(pane()?.textContent).toContain("/work/repo");
    expect(pane()?.textContent).toContain("main");
    hover("worktree");
    expect(
      document.querySelectorAll("[data-spotlight-detail-pane]")
    ).toHaveLength(1);
    expect(pane()?.textContent).toContain("/work/tree");
    expect(pane()?.children).toHaveLength(3);
    expect(pane()!.children[0].querySelector("svg")).toBeNull();
    expect(pane()!.children[1].querySelector("svg")).not.toBeNull();
    expect(pane()!.children[2].querySelector("svg")).not.toBeNull();
    expect(pane()?.textContent).not.toContain("19m");
    expect(pane()?.textContent).not.toContain("2026-09-07");
    expect(select).not.toHaveBeenCalled();
  });
  it("does not show a detail card for branch rows", () => {
    hover("branch");
    expect(pane()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stacks each repository name and visible path without a workspace heading", () => {
    hover("folders");
    const repos = pane()?.querySelector("[data-spotlight-repo-details]");
    expect(repos?.children).toHaveLength(2);
    for (const [index, name] of ["client", "server"].entries()) {
      const detail = repos!.children[index];
      expect(detail.children[0].textContent).toBe(name);
      expect(detail.children[0].querySelector("svg")).toBeNull();
      expect(detail.children[1].querySelector("svg")).not.toBeNull();
      expect(detail.children[1].textContent).toBe(`/work/${name}`);
      expect(detail.querySelector("[title], [aria-label]")).toBeNull();
    }
    expect(pane()?.textContent).not.toContain("Workspace");
    expect(pane()?.querySelector("[data-spotlight-folder-chips]")).toBeNull();
  });
  it("shows a plain folder title and equally styled branch and path icon rows", () => {
    hover("worktree");
    const heading = pane()!.children[0];
    expect(heading.textContent).toBe("tree");
    expect(heading.querySelector("svg")).toBeNull();
    expect(pane()!.children[1].textContent).toBe("dev/feature");
    expect(pane()!.children[1].querySelectorAll("svg")).toHaveLength(1);
    expect(pane()!.children[2].textContent).toBe("/work/tree");
    expect(pane()!.querySelector("[title], [aria-label]")).toBeNull();
    expect(pane()!.children[2].querySelectorAll("svg")).toHaveLength(2);
    expect(pane()!.children[1].className).toBe(pane()!.children[2].className);
  });
  it("uses a plain repository title with secondary branch and path icons", () => {
    hover("repo");
    expect(pane()!.children[0].textContent).toBe("Repository");
    expect(pane()!.children[0].querySelector("svg")).toBeNull();
    expect(pane()!.children[1].textContent).toBe("main");
    expect(pane()!.children[2].textContent).toBe("/work/repo");
    expect(pane()!.children[1].querySelector("svg")).not.toBeNull();
    expect(pane()!.children[2].querySelector("svg")).not.toBeNull();
  });
  it("opens local paths without selecting the picker row", () => {
    hover("worktree");
    const link = pane()!.querySelector("button")!;
    expect(link.textContent).toBe("/work/tree");
    expect(link.className).toContain("hover:underline");
    expect(link.querySelector("svg")?.getAttribute("class")).toContain(
      "group-hover/path:opacity-100"
    );
    act(() => link.click());
    expect(openPath).toHaveBeenCalledWith("/work/tree");
    expect(select).not.toHaveBeenCalled();
  });
  it("keeps remote repository URLs out of the local path opener", () => {
    hover("remote-repo");
    expect(pane()!.textContent).toContain("https://example.com/repo");
    expect(pane()!.querySelector("button")).toBeNull();
  });
  it("lets the pointer enter the pane without dismissing or selecting the row", () => {
    hover("repo");
    act(() => {
      container
        .querySelector("[data-spotlight-item-id='repo']")!
        .dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      pane()!.parentElement!.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true })
      );
      vi.advanceTimersByTime(150);
    });
    expect(pane()).not.toBeNull();
    act(() => pane()!.click());
    expect(select).not.toHaveBeenCalled();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(pane()).toBeNull();
  });
  it("repositions below on resize and dismisses on list scroll", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 294,
      left: 40,
      right: 700,
      width: 660,
      height: 244,
    } as DOMRect);
    const row = container.querySelector("[data-spotlight-item-id='repo']")!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: 150,
      bottom: 182,
      left: 48,
      right: 692,
      width: 644,
      height: 32,
    } as DOMRect);
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 800);
    hover("repo");
    expect(pane()?.parentElement?.style.left).toBe("708px");
    expect(pane()?.parentElement?.style.top).toBe("150px");
    expect(pane()?.parentElement?.classList.contains("rounded-2xl")).toBe(true);
    expect(pane()?.classList.contains("shadow-xl")).toBe(false);
    vi.stubGlobal("innerWidth", 600);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(pane()?.parentElement?.style.top).toBe("302px");
    act(() => container.dispatchEvent(new Event("scroll")));
    expect(pane()).toBeNull();
  });
  it("cancels pending hover when the picker unmounts", () => {
    act(() =>
      container
        .querySelector("[data-spotlight-item-id='repo']")!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    );
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(1000));
    expect(pane()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
