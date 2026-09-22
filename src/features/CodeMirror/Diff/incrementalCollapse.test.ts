// @vitest-environment jsdom
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { collapsedGutterBackground } from "./collapsedGutter";
import { diffLineNumbers } from "./diffLineNumbers";
import {
  COLLAPSED_COMPACT_ROW_PX,
  incrementalCollapse,
} from "./incrementalCollapse";

// Gaps with margin 3: top 122 lines, middle 193, bottom 71 (step is 50).
const original = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
const modified = original
  .replace("line 125\n", "changed 125\n")
  .replace("line 325\n", "changed 325\n");
const extensions = [
  collapsedGutterBackground,
  diffLineNumbers({ formatNumber: String }),
];
const mounted: { destroy(): void }[] = [];
function editor() {
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
  return view;
}
const labels = (view: EditorView) =>
  Array.from(
    view.dom.querySelectorAll(".cm-collapsedLines"),
    (node) => node.textContent
  );
function click(
  view: EditorView,
  index: number,
  direction: "up" | "down" | "all"
) {
  view.dom
    .querySelectorAll(".cm-collapseControl")
    [index].querySelector<HTMLButtonElement>(`.cm-collapseArrow--${direction}`)!
    .click();
}
afterEach(() => {
  mounted.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("incremental collapse", () => {
  it("reveals fifty lines from either end, then removes the final short remainder", () => {
    const view = editor();
    expect(labels(view)).toEqual([
      "122 unchanged lines",
      "193 unchanged lines",
      "71 unchanged lines",
    ]);
    click(view, 1, "down");
    let range = view.state.field(incrementalCollapse).iter();
    expect(view.state.doc.lineAt(range.from).number).toBe(180);
    expect(view.state.doc.lineAt(range.to).number).toBe(322);
    click(view, 1, "up");
    range = view.state.field(incrementalCollapse).iter();
    expect(view.state.doc.lineAt(range.from).number).toBe(180);
    expect(view.state.doc.lineAt(range.to).number).toBe(272);
    expect(labels(view)[1]).toBe("93 unchanged lines");
    expect(
      view.dom.querySelectorAll(".cm-collapseControl")[1].children
    ).toHaveLength(1);
    click(view, 1, "all");
    // Rows below the opened block leave jsdom's estimated viewport, so check
    // the retained ranges instead of rendered labels.
    expect(view.state.field(incrementalCollapse).size).toBe(0);
    expect(labels(view)[0]).toBe("122 unchanged lines");
  });

  it("steps edge rows from their label and keeps middle labels as expand-all", () => {
    const view = editor();
    const rows = () =>
      view.dom.querySelectorAll<HTMLElement>(".cm-collapsedLines");
    const last = () => rows()[rows().length - 1];
    last().click();
    expect(labels(view)).toEqual([
      "122 unchanged lines",
      "193 unchanged lines",
      "21 unchanged lines",
    ]);
    // The final short remainder opens completely.
    last().click();
    expect(labels(view)).toEqual([
      "122 unchanged lines",
      "193 unchanged lines",
    ]);
    rows()[0].click();
    expect(labels(view)).toEqual(["72 unchanged lines", "193 unchanged lines"]);
    rows()[1].click();
    expect(labels(view)[0]).toBe("72 unchanged lines");
    expect(labels(view)).not.toContain("193 unchanged lines");
  });

  it("reports the remaining row's exact height so an unmeasured rebuild still matches", () => {
    const view = editor();
    click(view, 1, "down");
    const range = view.state.field(incrementalCollapse).iter();
    // jsdom never measures, so this is the widget estimate CodeMirror falls
    // back to when MergeView spacer updates rebuild the height map.
    expect(view.lineBlockAt(range.from).height).toBe(COLLAPSED_COMPACT_ROW_PX);
  });

  it("synchronizes panes with different offsets before the hidden block", () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: original, extensions },
      b: {
        doc: modified.replace("changed 125", "extra\nchanged 125"),
        extensions,
      },
      collapseUnchanged: { margin: 3, minSize: 10 },
    });
    mounted.push(merge);
    click(merge.b, 1, "down");
    expect(labels(merge.a)).toEqual(labels(merge.b));
    const a = merge.a.state.field(incrementalCollapse).iter();
    const b = merge.b.state.field(incrementalCollapse).iter();
    expect(merge.b.state.doc.lineAt(b.from).number).toBe(
      merge.a.state.doc.lineAt(a.from).number + 1
    );
    click(merge.a, 1, "up");
    expect(labels(merge.a)).toEqual(labels(merge.b));
    const hidden = merge.b.state.field(incrementalCollapse).iter();
    merge.b.dispatch({ changes: { from: hidden.from + 1, insert: "edited" } });
    expect(merge.a.state.field(incrementalCollapse).size).toBe(0);
    expect(merge.b.state.field(incrementalCollapse).size).toBe(0);
  });

  it("maps remaining ranges through edits above and reveals edited hidden text", () => {
    const view = editor();
    click(view, 1, "down");
    view.dispatch({ changes: { from: 0, insert: "prefix\n" } });
    const range = view.state.field(incrementalCollapse).iter();
    expect(view.state.doc.lineAt(range.from).number).toBe(181);
    view.dispatch({ changes: { from: range.from + 1, insert: "edited" } });
    expect(view.state.field(incrementalCollapse).size).toBe(0);
  });
});
