import { readTextFile } from "@tauri-apps/plugin-fs";

import { updateTextFileSerial } from "@src/services/file/writeTextFileSerial";
import type {
  SearchOptions,
  SearchResultFile,
} from "@src/store/workstation/codeEditor/search";

/** Replace only native search ranges after revalidating against current disk content.
 * Unicode whole-word and glob semantics therefore remain owned by the search engine.
 */
export function replaceSearchFile(
  file: SearchResultFile,
  query: string,
  replacement: string,
  options: Pick<SearchOptions, "caseSensitive" | "useRegex">
): Promise<void> {
  return updateTextFileSerial(file.file_path, async (target) => {
    const content = await readTextFile(target);
    const lines = [0];
    for (
      let at = content.indexOf("\n");
      at !== -1;
      at = content.indexOf("\n", at + 1)
    )
      lines.push(at + 1);
    const regex = options.useRegex
      ? new RegExp(query, options.caseSensitive ? "umy" : "umiy")
      : null;
    const edits = file.matches
      .map((hit) => {
        const start = lines[hit.line - 1] + hit.column - 1;
        const end = lines[hit.end_line - 1] + hit.end_column - 1;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start ||
          content.slice(start, end) !== hit.text ||
          content.slice(start - hit.context_before.length, start) !==
            hit.context_before ||
          content.slice(end, end + hit.context_after.length) !==
            hit.context_after
        ) {
          throw new Error(
            "Search results changed; search again before replacing"
          );
        }
        let capture: RegExpExecArray | null = null;
        if (regex) {
          regex.lastIndex = start;
          capture = regex.exec(content);
          if (!capture || capture.index !== start || capture[0] !== hit.text)
            throw new Error(
              "Search pattern cannot be replaced consistently; refine the pattern"
            );
        }
        // Preserve JavaScript replacement tokens while using native verified ranges.
        const text = replacement.replace(
          /\$(\$|&|`|'|<[^>]*>|[0-9]{1,2})/g,
          (token, part: string) => {
            if (part === "$") return "$";
            if (part === "&") return hit.text;
            if (part === "`") return content.slice(0, start);
            if (part === "'") return content.slice(end);
            if (part.startsWith("<"))
              return capture?.groups
                ? (capture.groups[part.slice(1, -1)] ?? "")
                : token;
            const index = Number(part);
            if (capture && index > 0 && index < capture.length)
              return capture[index] ?? "";
            const first = Number(part[0]);
            if (
              capture &&
              part.length === 2 &&
              first > 0 &&
              first < capture.length
            )
              return (capture[first] ?? "") + part[1];
            return token;
          }
        );
        return { start, end, text };
      })
      .sort((a, b) => a.start - b.start);
    let end = 0;
    let updated = "";
    for (const edit of edits) {
      if (edit.start < end)
        throw new Error("Search ranges overlap; search again before replacing");
      updated += content.slice(end, edit.start) + edit.text;
      end = edit.end;
    }
    return updated + content.slice(end);
  });
}

/** All-or-explicitly-partial: never label the first loaded batch as Replace All. */
export async function replaceSearchResults(
  files: SearchResultFile[],
  query: string,
  replacement: string,
  options: Pick<SearchOptions, "caseSensitive" | "useRegex">,
  state: {
    loading: boolean;
    hasMore: boolean;
    isTruncated: boolean;
    error: string | null;
  }
): Promise<void> {
  if (state.loading || state.hasMore || state.isTruncated || state.error)
    throw new Error(
      "Search results are incomplete; narrow the scope or load all results before replacing"
    );
  for (const file of files)
    await replaceSearchFile(file, query, replacement, options);
}
