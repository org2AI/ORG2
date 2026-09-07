// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissHoverCard } from "@src/components/SessionHoverCard/singletonStore";

import { SpotlightItemRow } from "./SpotlightItemRow";

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
    hover("branch");
    expect(
      document.querySelectorAll("[data-spotlight-detail-pane]")
    ).toHaveLength(1);
    expect(pane()?.textContent).toContain("/work/tree");
    expect(pane()?.textContent).toContain("git.remote");
    expect(pane()?.children).toHaveLength(2);
    expect(pane()?.textContent).not.toContain("19m");
    expect(pane()?.textContent).not.toContain("2026-09-07");
    expect(select).not.toHaveBeenCalled();
  });
  it("shows multi-folder names as separate chips instead of the primary path", () => {
    hover("folders");
    const chips = pane()?.querySelector("[data-spotlight-folder-chips]");
    expect(chips?.children).toHaveLength(2);
    expect(chips?.textContent).toContain("client");
    expect(chips?.textContent).toContain("server");
    expect(pane()?.textContent).not.toContain("/work/client");
    expect(chips?.firstElementChild?.getAttribute("title")).toBe(
      "/work/client"
    );
    expect(pane()?.children).toHaveLength(2);
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
