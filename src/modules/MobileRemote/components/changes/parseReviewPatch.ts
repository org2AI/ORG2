export interface ReviewPatchLine {
  kind: "context" | "added" | "deleted";
  text: string;
  oldLine: number | null;
  newLine: number | null;
  noNewline?: boolean;
}
export interface ReviewPatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ReviewPatchLine[];
  additions: number;
  deletions: number;
}

/** Presentation projection only: preserve patch order and coordinates, never
 * reconstruct missing whole-file snapshots or sum overlapping edits as net. */
export function parseReviewPatch(patch: string): ReviewPatchHunk[] | null {
  if (patch.length > 524288) return null;
  const input = patch.replace(/\r\n/g, "\n").split("\n");
  if (input.length > 10000) return null;
  const hunks: ReviewPatchHunk[] = [];
  let hunk: ReviewPatchHunk | undefined;
  let oldUsed = 0;
  let newUsed = 0;
  for (let index = 0; index < input.length; index++) {
    const line = input[index];
    if (index === input.length - 1 && line === "") break;
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(
      line
    );
    if (header) {
      // A truncated hunk must not be silently joined with a later edit.
      if (hunk && (oldUsed !== hunk.oldCount || newUsed !== hunk.newCount))
        return null;
      const [oldStart, oldCount, newStart, newCount] = [
        Number(header[1]),
        Number(header[2] ?? 1),
        Number(header[3]),
        Number(header[4] ?? 1),
      ];
      if (
        ![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger) ||
        !Number.isSafeInteger(oldStart + oldCount) ||
        !Number.isSafeInteger(newStart + newCount) ||
        (oldCount > 0 && oldStart === 0) ||
        (newCount > 0 && newStart === 0)
      )
        return null;
      hunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
        additions: 0,
        deletions: 0,
      };
      hunks.push(hunk);
      oldUsed = 0;
      newUsed = 0;
      continue;
    }
    if (line === "\\ No newline at end of file" && hunk?.lines.length) {
      hunk.lines[hunk.lines.length - 1].noNewline = true;
      continue;
    }
    if (hunk && (oldUsed < hunk.oldCount || newUsed < hunk.newCount)) {
      const marker = line[0];
      if (marker !== "+" && marker !== "-" && marker !== " ") return null;
      const added = marker === "+";
      const deleted = marker === "-";
      hunk.lines.push({
        kind: added ? "added" : deleted ? "deleted" : "context",
        text: line.slice(1),
        oldLine: added ? null : hunk.oldStart + oldUsed++,
        newLine: deleted ? null : hunk.newStart + newUsed++,
      });
      if (added) hunk.additions++;
      if (deleted) hunk.deletions++;
      if (oldUsed > hunk.oldCount || newUsed > hunk.newCount) return null;
      continue;
    }
    if (
      /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to )/.test(
        line
      )
    )
      continue;
    return null;
  }
  if (!hunk || oldUsed !== hunk.oldCount || newUsed !== hunk.newCount)
    return null;
  return hunks;
}
