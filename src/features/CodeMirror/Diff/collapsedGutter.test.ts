// @vitest-environment jsdom
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLAPSED_COMPACT_ROW_HEIGHT,
  COLLAPSED_SPLIT_ROW_HEIGHT,
  MERGE_THEME_OVERRIDE,
} from ".";
import {
  COLLAPSED_SPLIT_ROW_CLASS,
  collapsedGutterBackground,
} from "./collapsedGutter";
import { diffLineNumbers } from "./diffLineNumbers";
import { COLLAPSED_COMPACT_ROW_PX } from "./incrementalCollapse";

// Gaps with margin 3: top 72 lines, middle 118 (> 2 steps, split), bottom 46.
const original = Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n");
const modified = original
  .replace("line 75\n", "changed 75\n")
  .replace("line 200\n", "changed 200\n");
const extensions = [
  collapsedGutterBackground,
  diffLineNumbers({ formatNumber: String }),
  MERGE_THEME_OVERRIDE,
];
const mounted: { destroy(): void }[] = [];

afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("collapsed gutter controls", () => {
  it("uses compact boundary rows and a taller split-control middle row", async () => {
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
    expect(rows).toHaveLength(3);
    await vi.waitFor(() =>
      expect(
        Array.from(rows, (row) =>
          row.classList.contains(COLLAPSED_SPLIT_ROW_CLASS)
        )
      ).toEqual([false, true, false])
    );
    expect(getComputedStyle(rows[0]).height).toBe(COLLAPSED_COMPACT_ROW_HEIGHT);
    expect(getComputedStyle(rows[1]).height).toBe(COLLAPSED_SPLIT_ROW_HEIGHT);
    expect(getComputedStyle(rows[2]).height).toBe(COLLAPSED_COMPACT_ROW_HEIGHT);
  });

  it.each([10, 50, 51, 100, 101])(
    "uses a single expand-all control for a short middle gap (%i lines)",
    async (lines) => {
      const doc = original
        .replace("line 30\n", "changed 30\n")
        .replace(`line ${37 + lines}\n`, `changed ${37 + lines}\n`);
      const merge = new MergeView({
        parent: document.body,
        a: { doc: original, extensions },
        b: { doc, extensions },
        collapseUnchanged: { margin: 3, minSize: 10 },
      });
      mounted.push(merge);
      for (const view of [merge.a, merge.b]) {
        const control = view.dom.querySelectorAll(".cm-collapseControl")[1];
        expect(control.children).toHaveLength(lines <= 100 ? 1 : 2);
        expect(
          control.parentElement?.classList.contains("cm-collapsedGutter--split")
        ).toBe(lines > 100);
        await vi.waitFor(() =>
          expect(
            view.dom
              .querySelectorAll(".cm-collapsedLines")[1]
              .classList.contains(COLLAPSED_SPLIT_ROW_CLASS)
          ).toBe(lines > 100)
        );
        expect(
          view.dom.querySelectorAll(".cm-collapsedLines")[1].textContent
        ).toBe(`${lines} unchanged lines`);
      }
      if (lines > 100) return;
      const button = merge.a.dom.querySelector<HTMLButtonElement>(
        ".cm-collapseArrow--all"
      )!;
      expect(button.getAttribute("aria-label")).toBe(
        `${lines} unchanged lines`
      );
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(
        merge.a.dom
          .querySelectorAll(".cm-collapsedLines")[1]
          .classList.contains("cm-collapsedRowHovered")
      ).toBe(true);
      button.click();
      for (const view of [merge.a, merge.b]) {
        expect(view.dom.querySelectorAll(".cm-collapsedLines")).toHaveLength(2);
        expect(
          view.dom.querySelectorAll(".cm-collapseArrow--all")
        ).toHaveLength(0);
      }
    }
  );

  it("highlights one-arrow rows whole, two-arrow rows part by part, and removes listeners on close", () => {
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
    // A two-arrow row has three actions: each stacked arrow highlights alone
    // (CSS :hover), so hovering one must not light the label or the row.
    for (const direction of ["down", "up"]) {
      rows[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      buttons[1]
        .querySelector(`.cm-collapseArrow--${direction}`)!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(view.dom.querySelectorAll(".cm-collapsedRowHovered")).toHaveLength(
        0
      );
    }
    // Its label lights the label bar only, never the arrows beside it.
    rows[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(rows[1].classList.contains("cm-collapsedRowHovered")).toBe(true);
    expect(
      buttons[1].parentElement?.classList.contains("cm-collapsedRowHovered")
    ).toBe(false);
    expect(
      view.dom.querySelectorAll(".cm-gutters .cm-collapsedRowHovered")
    ).toHaveLength(0);
    buttons[1].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(view.dom.querySelectorAll(".cm-collapsedRowHovered")).toHaveLength(
      0
    );
    // A one-arrow row still highlights as a whole from its arrow.
    buttons[0].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(rows[0].classList.contains("cm-collapsedRowHovered")).toBe(true);
    expect(rows[1].classList.contains("cm-collapsedRowHovered")).toBe(false);
    buttons[0].dispatchEvent(
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

  it("highlights both halves of the shared split row from either pane", () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      collapseUnchanged: { margin: 3, minSize: 10 },
    });
    mounted.push(merge);
    const rows = (view: EditorView) =>
      view.dom.querySelectorAll<HTMLElement>(".cm-collapsedLines");
    rows(merge.b)[2].dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true })
    );
    for (const view of [merge.a, merge.b]) {
      expect(
        Array.from(rows(view), (row) =>
          row.classList.contains("cm-collapsedRowHovered")
        )
      ).toEqual([false, false, true]);
    }
    // Two-arrow row: the label bar lights across both panes, including the
    // new pane's gutter, but never the arrows' gutter in the old pane.
    rows(merge.b)[1].dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true })
    );
    const hoveredGutterCells = (view: EditorView) =>
      view.dom.querySelectorAll(".cm-gutters .cm-collapsedRowHovered").length;
    expect(rows(merge.a)[1].classList.contains("cm-collapsedRowHovered")).toBe(
      true
    );
    expect(hoveredGutterCells(merge.a)).toBe(0);
    expect(hoveredGutterCells(merge.b)).toBeGreaterThan(0);
    rows(merge.a)[2].dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      })
    );
    for (const view of [merge.a, merge.b]) {
      expect(view.dom.querySelectorAll(".cm-collapsedRowHovered")).toHaveLength(
        0
      );
    }
  });

  it("reports the fixed compact height for merge's own collapsed rows", () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      collapseUnchanged: { margin: 3, minSize: 10 },
    });
    mounted.push(merge);
    // A rebuild from the estimate (jsdom never measures) must match the row.
    merge.b.dispatch({ changes: { from: 0, insert: "x" } });
    const last = merge.b.viewportLineBlocks.at(-1)!;
    expect(last.height).toBe(COLLAPSED_COMPACT_ROW_PX);
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
      "22 unchanged lines"
    );
    expect(merge.b.dom.querySelector(".cm-collapsedLines")?.textContent).toBe(
      "22 unchanged lines"
    );
  });

  it("returns a split row to compact height when one expansion leaves a short gap", async () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      collapseUnchanged: { margin: 3, minSize: 10 },
    });
    mounted.push(merge);

    await vi.waitFor(() => {
      for (const view of [merge.a, merge.b]) {
        expect(
          view.dom
            .querySelectorAll(".cm-collapsedLines")[1]
            .classList.contains(COLLAPSED_SPLIT_ROW_CLASS)
        ).toBe(true);
      }
    });

    merge.a.dom
      .querySelectorAll<HTMLElement>(".cm-collapseControl")[1]
      .querySelector<HTMLButtonElement>(".cm-collapseArrow--down")!
      .click();

    await vi.waitFor(() => {
      for (const view of [merge.a, merge.b]) {
        expect(
          view.dom
            .querySelectorAll(".cm-collapsedLines")[1]
            .classList.contains(COLLAPSED_SPLIT_ROW_CLASS)
        ).toBe(false);
        expect(
          view.dom.querySelectorAll(".cm-collapseControl")[1].children
        ).toHaveLength(1);
      }
    });
  });
});
