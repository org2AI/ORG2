// @vitest-environment jsdom
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { collapsedGutterBackground } from "./collapsedGutter";
import { diffLineNumbers } from "./diffLineNumbers";
import { incrementalCollapse } from "./incrementalCollapse";

const original = Array.from({ length: 160 }, (_, i) => `line ${i}`).join("\n");
const modified = original
  .replace("line 50\n", "changed 50\n")
  .replace("line 130\n", "changed 130\n");
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
function click(view: EditorView, index: number, direction: "up" | "down") {
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
  it("reveals twenty lines from either end, then removes the final short remainder", () => {
    const view = editor();
    expect(labels(view)).toEqual([
      "47 unchanged lines",
      "73 unchanged lines",
      "26 unchanged lines",
    ]);
    click(view, 1, "down");
    let range = view.state.field(incrementalCollapse).iter();
    expect(view.state.doc.lineAt(range.from).number).toBe(75);
    expect(view.state.doc.lineAt(range.to).number).toBe(127);
    click(view, 1, "up");
    range = view.state.field(incrementalCollapse).iter();
    expect(view.state.doc.lineAt(range.from).number).toBe(75);
    expect(view.state.doc.lineAt(range.to).number).toBe(107);
    expect(labels(view)[1]).toBe("33 unchanged lines");
    click(view, 1, "down");
    expect(labels(view)[1]).toBe("13 unchanged lines");
    click(view, 1, "up");
    expect(labels(view)).toEqual(["47 unchanged lines", "26 unchanged lines"]);
  });

  it("keeps label clicks as expand-all after partial expansion", () => {
    const view = editor();
    click(view, 0, "up");
    expect(labels(view)[0]).toBe("27 unchanged lines");
    view.dom.querySelector<HTMLElement>(".cm-collapsedLines")!.click();
    expect(labels(view)).toEqual(["73 unchanged lines", "26 unchanged lines"]);
  });

  it("synchronizes panes with different offsets before the hidden block", () => {
    const merge = new MergeView({
      parent: document.body,
      a: { doc: original, extensions },
      b: {
        doc: modified.replace("changed 50", "extra\nchanged 50"),
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
    expect(view.state.doc.lineAt(range.from).number).toBe(76);
    view.dispatch({ changes: { from: range.from + 1, insert: "edited" } });
    expect(view.state.field(incrementalCollapse).size).toBe(0);
  });
});
