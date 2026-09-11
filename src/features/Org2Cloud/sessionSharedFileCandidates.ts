import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export interface SessionSharedFileCandidate {
  path: string;
  revision: string;
}
/** Resolve sender paths without consulting the receiving machine's workspace. */
export function sharedFileAbsolutePath(
  path: string,
  repoPath?: string
): string | null {
  let value = path.trim().replace(/^<|>$/g, "");
  if (value.startsWith("#") || value.startsWith("~/")) return null;
  if (value.startsWith("file:")) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return null;
      value = decodeURIComponent(url.pathname).replace(
        /^\/([A-Za-z]:\/)/,
        "$1"
      );
    } catch {
      return null;
    }
  } else {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* A literal percent is valid in a filename. */
    }
  }
  value = value.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[A-Za-z]:[\\/]/.test(value))
    return null;
  value = value.replace(/:(\d+)(?::\d+)?$/, "").replace(/\\/g, "/");
  if (!value.trim()) return null;
  if (!value.startsWith("/") && !/^[A-Za-z]:\//.test(value)) {
    if (!repoPath) return null;
    value = `${repoPath.replace(/\/$/, "")}/${value}`;
  }
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}
/** Only explicit user references, generated-file links, and successful writes. Reads never opt files into sharing. */
export function collectSessionSharedFiles(
  events: readonly SessionEvent[],
  repoPath?: string
): SessionSharedFileCandidate[] {
  const files = new Map<string, SessionSharedFileCandidate>();
  for (const event of events) {
    if (event.displayStatus !== "completed" || event.source === "system")
      continue;
    const add = (path: string) => {
      const absolute = sharedFileAbsolutePath(path, event.repoPath || repoPath);
      if (absolute)
        files.set(absolute, {
          path: absolute,
          revision: `${event.id}:${event.createdAt}`,
        });
    };
    if (
      event.filePath &&
      /^(write_file|create_file|edit_file|apply_patch|edit_file_by_replace)$/.test(
        event.uiCanonical || event.functionName
      )
    )
      add(event.filePath);
    const data = event.extracted;
    if (data?.kind === "edit") {
      if (!data.isDeleted && data.filePath) add(data.filePath);
      const segments = [...(data.applyPatchSegments ?? [])];
      while (segments.length) {
        const segment = segments.pop()!;
        if (!segment.isDeleted && segment.filePath) add(segment.filePath);
        segments.push(...(segment.applyPatchSegments ?? []));
      }
    } else if (
      data?.kind === "file" &&
      /^(write_file|create_file|write|create)$/.test(
        event.uiCanonical || event.functionName
      )
    ) {
      add(data.filePath);
    }
    if (
      event.source === "user" ||
      event.displayVariant === "message" ||
      event.actionType === "assistant" ||
      event.actionType === "message" ||
      event.uiCanonical === "message"
    ) {
      for (const match of event.displayText.matchAll(/\[file:([^\]\r\n]+)\]/g))
        add(match[1]);
      for (const match of event.displayText.matchAll(
        /\[[^\]\n]+\]\((<[^>]+>|[^)\s]+)\)/g
      )) {
        if (!/^https?:/i.test(match[1])) add(match[1]);
      }
    }
  }
  return [...files.values()];
}
