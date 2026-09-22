// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { settingsAtom } from "@src/store/settings/settingsAtom";
import { gitSourceControlColorFileNamesAtom } from "@src/store/ui/editorSettingsAtom";

import { SourceControlStickyHeader } from "./SourceControlStickyHeader";
import SourceControlTreeRow from "./SourceControlTreeRow";

vi.mock("@src/components/FileTreePreview/exports", () => ({
  FileTreeHoverPreview: ({
    path,
    repoPath,
    itemType,
    children,
  }: {
    path: string;
    repoPath?: string;
    itemType: string;
    children: ReactNode;
  }) =>
    createElement(
      "div",
      {
        "data-preview-path": path,
        "data-preview-repo": repoPath,
        "data-preview-type": itemType,
      },
      children
    ),
}));

vi.mock("@src/scaffold/ActionSystem", () => ({
  useActionSystemOptional: () => null,
}));
vi.mock("@src/hooks/files/useNativeDrag", () => ({
  useNativeDrag: () => ({ handleMouseDown: vi.fn() }),
}));

vi.mock("./SourceControlContextMenu", () => ({ default: () => null }));

describe("SourceControlTreeRow section actions", () => {
  it.each(["file", "directory"] as const)(
    "previews the canonical worktree path for %s rows and sticky headers",
    (nodeType) => {
      const node = {
        path: "unstaged:src/nested",
        name: "src / nested",
        nodeType,
        isFolder: nodeType === "directory",
        expanded: true,
        section: "unstaged" as const,
        treeNode: {
          path: "src/nested",
          name: "nested",
          type: nodeType,
        },
      };
      for (const component of [
        createElement(SourceControlTreeRow, {
          node,
          depth: 1,
          overrideRepoPath: "/worktree",
        }),
        createElement(SourceControlStickyHeader, {
          stickyNode: {
            node,
            depth: 1,
            startIndex: 0,
            endIndex: 0,
            position: 0,
            height: 28,
          },
          onClick: vi.fn(),
          repoPath: "/worktree",
        }),
      ]) {
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(component);
        const preview = root.querySelector("[data-preview-path]")!;
        expect(preview.getAttribute("data-preview-path")).toBe(
          "/worktree/src/nested"
        );
        expect(preview.getAttribute("data-preview-repo")).toBe("/worktree");
        expect(preview.getAttribute("data-preview-type")).toBe(
          nodeType === "directory" ? "folder" : "file"
        );
        expect(root.querySelector("[title]")).toBeNull();
      }
    }
  );

  it("reveals all unstaged actions together without mixing opacity fades and display changes", () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(
      createElement(SourceControlTreeRow, {
        node: {
          path: "unstaged",
          name: "Changes",
          isFolder: true,
          expanded: true,
          nodeType: "section-header",
          section: "unstaged",
          count: 112,
        },
        depth: 0,
        onStashPush: vi.fn(),
        hasChangesToStash: true,
      })
    );
    expect(root.querySelector("button[aria-expanded]")).not.toBeNull();
    const actions = root.querySelectorAll<HTMLButtonElement>(
      "button:not([aria-expanded])"
    );
    expect(actions).toHaveLength(3);
    const group = actions[0].parentElement!;
    expect(group.classList.contains("gap-px")).toBe(true);
    expect(group.classList.contains("hidden")).toBe(true);
    expect(group.classList.contains("group-hover/header:flex")).toBe(true);
    expect(group.classList.contains("group-focus-within/header:flex")).toBe(
      true
    );
    for (const action of actions) {
      expect(action.parentElement).toBe(group);
      expect(action.style.width).toBe("20px");
      expect(action.classList.contains("shrink-0")).toBe(true);
      expect(action.className).not.toContain("opacity-0");
    }
  });
  it("groups file actions at 1px without grouping the status badge", () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(
      createElement(SourceControlTreeRow, {
        node: {
          path: "file.ts",
          name: "file.ts",
          isFolder: false,
          expanded: false,
          nodeType: "file",
          section: "unstaged",
          file: {
            id: "file.ts",
            path: "file.ts",
            status: "modified",
            staged: false,
            additions: 1,
            deletions: 0,
          },
        },
        depth: 0,
        onDiscard: vi.fn(),
        onStageToggle: vi.fn(),
      })
    );
    const actions = root.querySelectorAll("button");
    expect(actions).toHaveLength(2);
    const group = actions[0].parentElement!;
    expect(actions[1].parentElement).toBe(group);
    expect(group.classList.contains("gap-px")).toBe(true);
    expect(group.classList.contains("group-hover/item:flex")).toBe(true);
    expect(group.children).toHaveLength(2);
    expect(group.nextElementSibling).not.toBeNull();
  });

  it("colors file names by diff status only when the default-off setting is enabled", () => {
    const store = createStore();
    const fileNode = {
      path: "file.ts",
      name: "file.ts",
      isFolder: false,
      expanded: false,
      nodeType: "file" as const,
      section: "unstaged" as const,
      file: {
        id: "file.ts",
        path: "file.ts",
        status: "modified" as const,
        staged: false,
        additions: 1,
        deletions: 0,
      },
    };
    const renderRow = () => {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(
        createElement(
          Provider,
          { store },
          createElement(SourceControlTreeRow, {
            node: fileNode,
            depth: 0,
          })
        )
      );
      return Array.from(root.querySelectorAll<HTMLElement>("span")).find(
        (element) =>
          element.classList.contains("text-[13px]") &&
          element.textContent === "file.ts"
      )!;
    };

    expect(store.get(gitSourceControlColorFileNamesAtom)).toBe(false);
    expect(renderRow().classList.contains("text-warning-6")).toBe(false);

    store.set(settingsAtom, (settings) => ({
      ...settings,
      "git.sourceControl.colorFileNames": true,
    }));
    expect(renderRow().classList.contains("text-warning-6")).toBe(true);
  });
});
