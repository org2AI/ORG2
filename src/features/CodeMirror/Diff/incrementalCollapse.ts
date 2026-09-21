import {
  getChunks,
  mergeViewSiblings,
  uncollapseUnchanged,
} from "@codemirror/merge";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

// Lines revealed per expand click on a one-direction collapsed row.
export const COLLAPSE_EXPAND_STEP = 50;
/**
 * Single-button collapsed row height in px. It is fixed (the row's text is a
 * fixed 12px) so `estimatedHeight` can be exact: in split view MergeView's
 * spacer updates rebuild height-map nodes from the estimate without the row's
 * DOM changing, so CodeMirror never re-measures it and the gutter would keep
 * a wrong estimate.
 */
export const COLLAPSED_COMPACT_ROW_PX = 32;
type ExpandSide = "start" | "end" | "all";
interface HiddenRange {
  from: number;
  to: number;
}
const replaceHiddenRange = StateEffect.define<{
  previous: HiddenRange;
  next: HiddenRange | null;
}>();

class RemainingLines extends WidgetType {
  constructor(readonly lines: number) {
    super();
  }
  get type() {
    return "collapsed-unchanged-code";
  }
  get estimatedHeight() {
    return COLLAPSED_COMPACT_ROW_PX;
  }
  eq(other: RemainingLines) {
    return this.lines === other.lines;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-collapsedLines";
    dom.textContent = view.state.phrase("$ unchanged lines", this.lines);
    dom.addEventListener("click", () => {
      const from = view.posAtDOM(dom);
      view.state.field(incrementalCollapse).between(from, from, (start, to) => {
        if (start === from) expandCollapsedRange(view, { from, to }, "all");
      });
    });
    return dom;
  }
  ignoreEvent(event: Event) {
    return event instanceof MouseEvent;
  }
}

/** Only retains the remaining part of blocks the user has partially opened. */
export const incrementalCollapse = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(ranges, transaction) {
    if (transaction.docChanged) {
      // Never keep newly edited text inside a collapsed unchanged region.
      ranges = ranges
        .update({
          filter: (from, to) => {
            let touched = false;
            transaction.changes.iterChangedRanges((start, end) => {
              if (start <= to && end >= from) touched = true;
            });
            return !touched;
          },
        })
        .map(transaction.changes);
    }
    const merge = getChunks(transaction.state);
    if (merge && merge.chunks !== getChunks(transaction.startState)?.chunks) {
      // A peer edit or original-document refresh can introduce changes even
      // when this pane's own document did not change.
      const isA = merge.side === "a";
      ranges = ranges.update({
        filter: (from, to) => {
          let low = 0,
            high = merge.chunks.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            const chunk = merge.chunks[middle];
            if ((isA ? chunk.toA : chunk.toB) < from) low = middle + 1;
            else high = middle;
          }
          const next = merge.chunks[low];
          return !next || (isA ? next.fromA : next.fromB) > to;
        },
      });
    }
    for (const effect of transaction.effects) {
      if (!effect.is(replaceHiddenRange)) continue;
      const { previous, next } = effect.value;
      ranges = ranges.update({
        filter: (from, to) => from !== previous.from || to !== previous.to,
        add: next
          ? [
              Decoration.replace({
                block: true,
                widget: new RemainingLines(
                  transaction.newDoc.lineAt(next.to).number -
                    transaction.newDoc.lineAt(next.from).number +
                    1
                ),
              }).range(next.from, next.to),
            ]
          : [],
        sort: true,
      });
    }
    return ranges;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function siblingPosition(view: EditorView, position: number) {
  const merge = getChunks(view.state);
  if (!merge) return position;
  const isA = merge.side === "a";
  let offset = 0;
  for (const chunk of merge.chunks) {
    const end = isA ? chunk.toA : chunk.toB;
    if (end > position) break;
    offset = isA ? chunk.toB - chunk.toA : chunk.toA - chunk.toB;
  }
  return position + offset;
}

function expandOne(view: EditorView, previous: HiddenRange, side: ExpandSide) {
  const doc = view.state.doc;
  const first = doc.lineAt(previous.from).number;
  const last = doc.lineAt(previous.to).number;
  const next =
    side === "all" || last - first + 1 <= COLLAPSE_EXPAND_STEP
      ? null
      : side === "start"
        ? { from: doc.line(first + COLLAPSE_EXPAND_STEP).from, to: previous.to }
        : { from: previous.from, to: doc.line(last - COLLAPSE_EXPAND_STEP).to };
  view.dispatch({
    effects: [
      uncollapseUnchanged.of(previous.from),
      replaceHiddenRange.of({ previous, next }),
    ],
  });
}

export function expandCollapsedRange(
  view: EditorView,
  range: HiddenRange,
  side: ExpandSide
) {
  const siblings = mergeViewSiblings(view);
  const sibling = siblings && (siblings.a === view ? siblings.b : siblings.a);
  const paired = sibling && {
    from: siblingPosition(view, range.from),
    to: siblingPosition(view, range.to),
  };
  expandOne(view, range, side);
  if (sibling && paired) expandOne(sibling, paired, side);
}
