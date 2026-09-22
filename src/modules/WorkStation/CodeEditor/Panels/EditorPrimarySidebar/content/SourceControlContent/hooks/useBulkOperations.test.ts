// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { TreeRowBase } from "@src/components/TreeRow";
import type { GitFile } from "@src/types/git/types";

import { useFileSelection } from "../../../hooks/useFileSelection";
import { useBulkOperations } from "./useBulkOperations";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/dialogs/confirmDestructiveAction", () => ({
  confirmDestructiveAction: vi.fn(),
}));
vi.mock("@src/util/dialogs/gitActionDialog", () => ({
  showGitActionDialogSafely: vi.fn(),
}));

it("highlights combined-diff navigation and replaces a previous bulk selection on plain click", () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const revealDiff = vi.fn();
  const files: GitFile[] = ["a", "b", "c"].map((id) => ({
    id,
    path: `${id}.ts`,
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 0,
  }));
  function Harness() {
    const selection = useFileSelection({ files });
    const operations = useBulkOperations({
      ...selection,
      onFileSelect: revealDiff,
    });
    return createElement(
      "div",
      null,
      files.map((file) =>
        createElement(TreeRowBase, {
          key: file.id,
          depth: 0,
          node: { id: file.id, name: file.path, path: file.path, type: "file" },
          dataPath: file.id,
          isSelected:
            selection.lastSelectedId === file.id &&
            selection.isFileSelected(file.id),
          isMultiSelected: selection.isFileSelected(file.id),
          onClick: (event) =>
            operations.handleFileSelectWithMultiSelect(file.id, event),
        })
      )
    );
  }
  const select = (id: string, modifiers: MouseEventInit = {}) =>
    host
      .querySelector(`[data-tree-path="${id}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
  const selected = () =>
    Array.from(host.querySelectorAll(".bg-surface-selected")).map((row) =>
      row.getAttribute("data-tree-path")
    );
  try {
    act(() => root.render(createElement(Harness)));
    act(() => host.querySelector<HTMLElement>('[data-tree-path="a"]')!.click());
    expect(revealDiff).toHaveBeenLastCalledWith("a");
    expect(selected()).toEqual(["a"]);
    expect(
      host.querySelector('[data-tree-path="a"] .font-medium')
    ).not.toBeNull();
    act(() => select("c", { shiftKey: true }));
    expect(selected()).toEqual(["a", "b", "c"]);
    expect(revealDiff).toHaveBeenCalledTimes(1);
    act(() => select("b", { metaKey: true }));
    expect(selected()).toEqual(["a", "c"]);
    act(() => select("b"));
    expect(selected()).toEqual(["b"]);
    expect(
      host.querySelector('[data-tree-path="b"] .font-medium')
    ).not.toBeNull();
    expect(host.querySelector('[data-tree-path="a"] .font-medium')).toBeNull();
    expect(revealDiff).toHaveBeenLastCalledWith("b");
  } finally {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
