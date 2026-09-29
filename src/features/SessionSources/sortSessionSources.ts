import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

export const SOURCE_SORTS = ["newest", "oldest", "provided-first"] as const;
export type SourceSort = (typeof SOURCE_SORTS)[number];

/** Extraction supplies newest-reference order; sorting never mutates it. */
export function sortSessionSources(
  sources: readonly SessionSource[],
  sort: SourceSort
): SessionSource[] {
  if (sort === "oldest") return [...sources].reverse();
  if (sort === "provided-first") {
    const isProvided = (source: SessionSource) =>
      [source.origin, ...(source.origins ?? [])].some(
        (origin) =>
          origin === "attachment" ||
          origin === "provided-file" ||
          origin === "provided-link"
      );
    // Keep reference order within each bucket, including deduplicated sources
    // whose most recent origin is an assistant or tool reference.
    return [
      ...sources.filter(isProvided),
      ...sources.filter((source) => !isProvided(source)),
    ];
  }
  return [...sources];
}
