import { type EditorState, RangeSet, StateField } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

import { changedNumberClass } from "./diffLineNumbers";

const activeChangedRowMarker = new (class extends GutterMarker {
  elementClass = "cm-activeChangedGutter";
})();

function activeChangedRows(state: EditorState) {
  const marks = [];
  let last = -1;
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.head).from;
    if (from <= last) continue;
    last = from;
    if (changedNumberClass(state, from)) {
      marks.push(activeChangedRowMarker.range(from));
    }
  }
  return RangeSet.of(marks);
}

/**
 * Tags every gutter cell of a current row that is an added or deleted line, so
 * the row can keep its diff colour instead of the neutral current-line fill.
 * The content line needs no help: it already carries `cm-changedLine`. Gutter
 * cells do not (the fold column has no diff class at all), and only the cursor
 * rows are classified, so large diffs stay cheap.
 *
 * A field rather than a selection-keyed facet: accepting or rejecting a chunk
 * changes the chunks without moving the selection.
 */
export const activeChangedRowGutter = StateField.define({
  create: activeChangedRows,
  update: (_rows, transaction) => activeChangedRows(transaction.state),
  provide: (field) => gutterLineClass.from(field),
});
