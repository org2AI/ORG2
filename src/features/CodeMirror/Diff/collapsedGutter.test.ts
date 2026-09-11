// @vitest-environment jsdom
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { collapsedGutterBackground } from "./collapsedGutter";
import { diffLineNumbers } from "./diffLineNumbers";

const original = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
const modified = original
  .replace("line 30\n", "changed 30\n")
  .replace("line 70\n", "changed 70\n");
const extensions = [
  collapsedGutterBackground,
  diffLineNumbers({ formatNumber: String }),
];
const mounted: { destroy(): void }[] = [];

afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("collapsed gutter controls", () => {
  it("highlights only the matching whole row from either half and removes listeners on close", () => {
    const view = new EditorView({
      parent: document.body,
      doc: modified,
      extensions: [
        ...extensions,
        unifiedMergeView({
          original,
          collapseUnchanged: { margin: 3, minSize: 10 },
        }),
      ],
    });
    mounted.push(view);
    const rows = view.dom.querySelectorAll<HTMLElement>(".cm-collapsedLines");
    const buttons = view.dom.querySelectorAll<HTMLButtonElement>(
      ".cm-collapseControl"
    );
    rows[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(rows[0].classList.contains("cm-collapsedRowHovered")).toBe(true);
    expect(
      buttons[0].parentElement?.classList.contains("cm-collapsedRowHovered")
    ).toBe(true);
    expect(rows[1].classList.contains("cm-collapsedRowHovered")).toBe(false);
    const topArrow = buttons[1].querySelector(".cm-collapseArrow--down")!;
    const bottomArrow = buttons[1].querySelector(".cm-collapseArrow--up")!;
    topArrow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(
      buttons[1].parentElement?.classList.contains("cm-collapsedRowHoverTop")
    ).toBe(true);
    expect(
      buttons[1].parentElement?.classList.contains("cm-collapsedRowHoverBottom")
    ).toBe(false);
    expect(rows[1].classList.contains("cm-collapsedRowHovered")).toBe(false);
    bottomArrow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(
      buttons[1].parentElement?.classList.contains("cm-collapsedRowHoverTop")
    ).toBe(false);
    expect(
      buttons[1].parentElement?.classList.contains("cm-collapsedRowHoverBottom")
    ).toBe(true);
    rows[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(
      buttons[1].parentElement?.classList.contains("cm-collapsedRowHovered")
    ).toBe(true);
    buttons[1].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(rows[0].classList.contains("cm-collapsedRowHovered")).toBe(false);
    expect(rows[1].classList.contains("cm-collapsedRowHovered")).toBe(true);
    buttons[1].dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: document.body,
      })
    );
    expect(view.dom.querySelectorAll(".cm-collapsedRowHovered")).toHaveLength(
      0
    );
    view.destroy();
    mounted.pop();
    rows[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(rows[0].classList.contains("cm-collapsedRowHovered")).toBe(false);
  });

  it("uses one boundary arrow and stacked middle arrows, and expands only the clicked block", () => {
    const view = new EditorView({
      parent: document.body,
      doc: modified,
      extensions: [
        ...extensions,
        unifiedMergeView({
          original,
          collapseUnchanged: { margin: 3, minSize: 10 },
        }),
      ],
    });
    mounted.push(view);
    const controls = view.dom.querySelectorAll<HTMLButtonElement>(
      ".cm-collapseControl"
    );
    expect(controls).toHaveLength(3);
    expect(controls[0].querySelectorAll(".cm-collapseArrow--up")).toHaveLength(
      1
    );
    expect(controls[0].children).toHaveLength(1);
    expect(controls[1].children).toHaveLength(2);
    expect(
      controls[2].querySelectorAll(".cm-collapseArrow--down")
    ).toHaveLength(1);
    expect(controls[2].children).toHaveLength(1);
    view.dom.querySelectorAll<HTMLElement>(".cm-collapsedLines")[1].click();
    expect(view.dom.querySelectorAll(".cm-collapsedLines")).toHaveLength(2);
    expect(view.dom.querySelectorAll(".cm-collapseControl")).toHaveLength(2);
  });

  it("keeps incremental split expansion synchronized", () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      collapseUnchanged: { margin: 3, minSize: 10 },
    });
    mounted.push(merge);
    const controls = merge.a.dom.querySelectorAll<HTMLButtonElement>(
      ".cm-collapseControl"
    );
    expect(controls).toHaveLength(3);
    controls[0].querySelector<HTMLButtonElement>(".cm-collapseArrow")!.click();
    expect(merge.a.dom.querySelectorAll(".cm-collapsedLines")).toHaveLength(3);
    expect(merge.a.dom.querySelector(".cm-collapsedLines")?.textContent).toBe(
      "7 unchanged lines"
    );
    expect(merge.b.dom.querySelector(".cm-collapsedLines")?.textContent).toBe(
      "7 unchanged lines"
    );
  });
});
