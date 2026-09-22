import {
  type MergeView,
  getChunks,
  uncollapseUnchanged,
} from "@codemirror/merge";
import { SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorView } from "@codemirror/view";

import type { ReviewSearchQuery } from "@src/modules/WorkStation/shared/DiffSectionList/search/reviewSearchTypes";

export interface ReviewDiffSearch {
  query: ReviewSearchQuery | null;
  match: { side: "old" | "new"; from: number; to: number } | null;
}

/** Navigate through the owning merge document, including deleted widgets. */
export function applyReviewSearch(
  unified: EditorView | null,
  split: MergeView | null,
  search: ReviewDiffSearch,
  fullDeletion: boolean
): () => void {
  const views = split ? [split.a, split.b] : unified ? [unified] : [];
  if (search.query)
    for (const view of views)
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery(search.query)),
      });
  const match = search.match;
  if (!match) return () => {};
  const view = split ? (match.side === "old" ? split.a : split.b) : unified;
  if (!view) return () => {};
  if (split || match.side === "new" || fullDeletion) {
    const from = Math.min(match.from, view.state.doc.length),
      to = Math.min(match.to, view.state.doc.length);
    view.dispatch({
      effects: [
        uncollapseUnchanged.of(from),
        EditorView.scrollIntoView(from, { y: "center" }),
      ],
      selection: { anchor: from, head: to },
    });
    return () => {};
  }
  const chunk = getChunks(view.state)?.chunks.find(
    (c) => match.from >= c.fromA && match.from < c.toA
  );
  if (!chunk) return () => {};
  const position = Math.min(chunk.fromB, view.state.doc.length);
  view.dispatch({
    effects: [
      uncollapseUnchanged.of(position),
      EditorView.scrollIntoView(position, { y: "center" }),
    ],
  });
  let highlighted: HTMLElement | undefined;
  const registry = (
    globalThis.CSS as
      | (typeof CSS & { highlights?: Map<string, unknown> })
      | undefined
  )?.highlights;
  const HighlightConstructor = (
    globalThis as typeof globalThis & {
      Highlight?: new (...ranges: Range[]) => unknown;
    }
  ).Highlight;
  const frame = requestAnimationFrame(() => {
    const widget = Array.from(
      view.dom.querySelectorAll<HTMLElement>(".cm-deletedChunk")
    ).find((el) => view.posAtDOM(el) === position);
    if (!widget) return;
    const before = Array.from(
      widget.querySelectorAll<HTMLElement>(".cm-deletedLine")
    );
    let offset = chunk.fromA;
    for (const line of before) {
      const end = offset + (line.textContent?.length ?? 0);
      if (match.from <= end && match.to > offset) {
        highlighted = line;
        line.classList.add("cm-review-search-match");
        if (registry && HighlightConstructor) {
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          let at = offset,
            started = false;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const length = node.textContent?.length ?? 0;
            if (!started && match.from < at + length) {
              range.setStart(node, Math.max(0, match.from - at));
              started = true;
            }
            if (started && Math.min(match.to, end) <= at + length) {
              range.setEnd(node, Math.max(0, Math.min(match.to, end) - at));
              registry.set(
                "orgii-review-search",
                new HighlightConstructor(range)
              );
              break;
            }
            at += length;
          }
        }
        line.scrollIntoView({ block: "center", behavior: "auto" });
        break;
      }
      offset = end + 1;
    }
  });
  return () => {
    cancelAnimationFrame(frame);
    highlighted?.classList.remove("cm-review-search-match");
    registry?.delete("orgii-review-search");
  };
}
