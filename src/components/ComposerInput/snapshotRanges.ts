import type { ComposerSnapshot } from "./types";
import { plainTextLength, rawIndexAtPlainOffset } from "./utils";

/** Length of a part in plain-text coordinates (see `caretTextOffset`). */
function partTextLength(part: ComposerSnapshot["parts"][number]): number {
  if (part.kind === "text") return plainTextLength(part.text);
  if (part.kind === "newline") return 1;
  return part.attrs.fileName.length;
}

export function removeSnapshotTextRange(
  snapshot: ComposerSnapshot,
  startOffset: number,
  endOffset: number
): ComposerSnapshot {
  const start = Math.max(0, startOffset);
  const end = Math.max(start, endOffset);
  let cursor = 0;
  const parts: ComposerSnapshot["parts"] = [];

  for (const part of snapshot.parts) {
    const length = partTextLength(part);
    const partStart = cursor;
    const partEnd = cursor + length;
    cursor = partEnd;

    if (partEnd <= start || partStart >= end) {
      parts.push(part);
      continue;
    }

    if (part.kind !== "text") continue;

    const removeStart = Math.max(0, start - partStart);
    const removeEnd = Math.min(length, end - partStart);
    const nextText =
      part.text.slice(0, rawIndexAtPlainOffset(part.text, removeStart)) +
      part.text.slice(rawIndexAtPlainOffset(part.text, removeEnd));
    if (nextText) parts.push({ kind: "text", text: nextText });
  }

  return { parts };
}
