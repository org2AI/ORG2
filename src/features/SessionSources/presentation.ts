/** Display metadata is derived separately from the references used for navigation. */
import type { TFunction } from "i18next";

import { parseGitHubPillUrl } from "@src/components/ComposerInput/githubUrl";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";
import {
  File01Icon,
  FolderClosedIcon,
  GitPullRequestIcon,
  InternetIcon,
  Link01Icon,
  Wrench01Icon,
} from "@src/icons";
import { imageRefToRustPath } from "@src/util/file/imageRefs";
import { formatToolName } from "@src/util/ui/rendering/formatToolName";

/** These are valid transport identities, not user-facing file locations. */
function isOpaqueLocation(value: string): boolean {
  return /^(?:data|blob|orgii-transcript-image|codex-inline-image|claude-inline-image):/iu.test(
    value
  );
}

export function sourceLocation(source: SessionSource): string | null {
  if (source.kind === "tool-group") return null;
  const location =
    source.kind === "image"
      ? imageRefToRustPath(source.ref)
      : source.kind === "file"
        ? source.path
        : source.url;
  return location && !isOpaqueLocation(location) ? location : null;
}

export function sourceLabel(t: TFunction, source: SessionSource): string {
  switch (source.kind) {
    case "tool-group":
      return source.group === "web"
        ? t("common:git.rail.toolGroupWeb")
        : source.group === "codex-app"
          ? t("common:git.rail.toolGroupCodexApp")
          : source.group
            ? formatToolName(source.group.replace(/^mcp:/u, ""))
            : t("common:git.rail.toolGroupGeneric");
    case "link":
      return source.label;
    case "file":
      return source.title || source.fileName;
    case "image":
      return source.fileName && !isOpaqueLocation(source.fileName)
        ? source.fileName
        : t("common:git.rail.sourceImage");
  }
}

export function sourceIcon(source: SessionSource) {
  if (source.kind === "tool-group")
    return source.group === "web" ? InternetIcon : Wrench01Icon;
  if (source.kind === "file")
    return source.isDirectory ? FolderClosedIcon : File01Icon;
  if (
    source.kind === "link" &&
    parseGitHubPillUrl(source.url)?.iconType === "pr"
  )
    return GitPullRequestIcon;
  return Link01Icon;
}

export function sourceProvenance(t: TFunction, source: SessionSource): string {
  if (source.kind === "tool-group") return "";
  const origins = source.origins ?? [
    source.origin ??
      (source.kind === "image"
        ? "attachment"
        : source.kind === "file"
          ? "provided-file"
          : "provided-link"),
  ];
  return origins
    .map((origin) => {
      const key =
        origin === "assistant-reference"
          ? "sourceAssistantReference"
          : origin === "tool-result"
            ? source.toolName
              ? "sourceToolResultNamed"
              : "sourceToolResult"
            : origin === "attachment"
              ? "sourceAttached"
              : origin === "provided-file"
                ? "sourceFileProvided"
                : "sourceLinkProvided";
      return t(`common:git.rail.${key}`, { tool: source.toolName });
    })
    .join(" · ");
}
