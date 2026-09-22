import { Chunk } from "@codemirror/merge";
import { SearchQuery } from "@codemirror/search";
import { Text } from "@codemirror/state";

import {
  REVIEW_SEARCH_LIMIT,
  type ReviewSearchFile,
  type ReviewSearchMatch,
} from "./reviewSearchTypes";

/** Search the complete payload, independent of virtualized/collapsed rows. */
export function searchReview(
  files: readonly ReviewSearchFile[],
  query: SearchQuery
) {
  const matches: ReviewSearchMatch[] = [];
  if (!query.valid || !query.search) return matches;
  for (const file of files) {
    if (file.isBinary || file.isUnavailable) continue;
    const oldText = file.oldContent ?? "";
    const newText = file.newContent ?? "";
    const changes = oldText
      ? Chunk.build(
          Text.of(oldText.split("\n")),
          Text.of(newText.split("\n")),
          { scanLimit: 500 }
        )
      : [];
    for (const side of ["new", "old"] as const) {
      const cursor = query.getCursor(
        Text.of((side === "new" ? newText : oldText).split("\n"))
      );
      for (let next = cursor.next(); !next.done; next = cursor.next()) {
        const { from, to } = next.value;
        // Unchanged context is counted once, on the new side.
        if (
          side === "old" &&
          !changes.some((c) => from < c.toA && to > c.fromA)
        )
          continue;
        matches.push({ path: file.path, side, from, to });
        if (matches.length >= REVIEW_SEARCH_LIMIT) return matches;
      }
    }
  }
  return matches;
}
