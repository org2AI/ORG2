import { getChunks } from "@codemirror/merge";
import type { EditorState } from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";

import { collapsedNumberControl } from "./collapsedGutter";

class DiffNumberMarker extends GutterMarker {
  constructor(
    readonly label: string,
    readonly elementClass = ""
  ) {
    super();
  }

  eq(other: DiffNumberMarker) {
    return (
      this.label === other.label && this.elementClass === other.elementClass
    );
  }

  toDOM() {
    return document.createTextNode(this.label);
  }
}

function changedNumberClass(state: EditorState, position: number) {
  const merge = getChunks(state);
  if (!merge) return "";
  const isOriginal = merge.side === "a";
  // Only classify the requested visible row; do not materialize every changed
  // line in large files or rescan all chunks for each gutter element.
  let low = 0;
  let high = merge.chunks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const chunk = merge.chunks[middle];
    const from = isOriginal ? chunk.fromA : chunk.fromB;
    const to = isOriginal ? chunk.toA : chunk.toB;
    if (position < from) high = middle;
    else if (position >= to) low = middle + 1;
    else return isOriginal ? "cm-diffDeletedNumber" : "cm-diffAddedNumber";
  }
  return "";
}

export function diffLineNumbers({
  formatNumber,
}: {
  formatNumber: (line: number, state: EditorState) => string;
}) {
  const spacer = (state: EditorState) => {
    let maximum = 9;
    while (maximum < state.doc.lines) maximum = maximum * 10 + 9;
    return new DiffNumberMarker(formatNumber(maximum, state));
  };

  return gutter({
    class: "cm-lineNumbers",
    widgetMarker: collapsedNumberControl,
    lineMarker: (view, line) =>
      new DiffNumberMarker(
        formatNumber(view.state.doc.lineAt(line.from).number, view.state),
        changedNumberClass(view.state, line.from)
      ),
    lineMarkerChange: (update) =>
      update.selectionSet ||
      getChunks(update.startState)?.chunks !== getChunks(update.state)?.chunks,
    initialSpacer: (view) => spacer(view.state),
    updateSpacer: (previous, update) => {
      const next = spacer(update.state);
      return previous.eq(next) ? previous : next;
    },
  });
}
