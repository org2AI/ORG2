import type { ComposerSnapshot } from "@src/components/ComposerInput";
import { serializePillNode } from "@src/components/ComposerInput/utils";

import type { SubmitMessageOptions } from "./types";

export function serializeSubmissionSnapshot(
  snapshot: ComposerSnapshot,
  omitMemberPills: boolean
): string {
  return snapshot.parts
    .map((part) => {
      if (part.kind === "text") return part.text;
      if (part.kind === "newline") return "\n";
      if (omitMemberPills && part.attrs.iconType === "member") return "";
      return serializePillNode(part.attrs);
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^[ \t]+|[ \t]+$/g, "");
}

export function memberMentionsFromSnapshot(
  snapshot: ComposerSnapshot
): Array<{ memberId: string; displayName: string }> {
  const seen = new Set<string>();
  const mentions: Array<{ memberId: string; displayName: string }> = [];
  for (const part of snapshot.parts) {
    if (part.kind !== "pill" || part.attrs.iconType !== "member") continue;
    if (!part.attrs.filePath.startsWith("member://")) {
      throw new Error("Agent Team Member pill has no canonical member:// id");
    }
    const memberId = part.attrs.filePath.slice("member://".length).trim();
    if (!memberId) {
      throw new Error("Agent Team Member pill has an empty canonical id");
    }
    if (seen.has(memberId)) continue;
    seen.add(memberId);
    mentions.push({ memberId, displayName: part.attrs.fileName });
  }
  return mentions;
}

export function resolveSubmitInput(
  options: SubmitMessageOptions,
  liveDisplayText: string,
  liveHasImages: boolean
): {
  isExplicitAction: boolean;
  displayText: string;
  hasAttachedImages: boolean;
} {
  const isExplicitAction = options.source === "explicit-action";
  return {
    isExplicitAction,
    displayText: isExplicitAction
      ? (options.capturedText ?? "")
      : liveDisplayText.trim().length > 0
        ? liveDisplayText
        : (options.capturedText ?? ""),
    hasAttachedImages: !isExplicitAction && liveHasImages,
  };
}
