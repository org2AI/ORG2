/**
 * Read-only reference primitives for rendered user messages.
 *
 * A reference looks the same after sending as it did while typing: the pill
 * face the composer showed, not a bare link. Presentation is shared with
 * `ComposerPill` through `renderPillIcon` so the two cannot drift; the click
 * behaviour stays local, because a sent message resolves terminal and paste
 * content from the text decoded off the message itself rather than from the
 * editor's in-memory store. Session references are lifted into cards before
 * this layer, and member mentions keep their own @ pill below.
 */
import { useAtomValue } from "jotai";
import React, { memo, useCallback } from "react";

import BasePill from "@src/components/ComposerInput/BasePill";
import { renderPillIcon } from "@src/components/ComposerInput/ComposerPill";
import { isGitHubPillUrl } from "@src/components/ComposerInput/githubUrl";
import {
  isSafePostedReferenceHref,
  resolvePostedReferenceHref,
} from "@src/components/ComposerInput/postedReferenceHref";
import {
  truncateVisibleLinkLabel,
  truncateVisiblePillLabel,
} from "@src/components/ComposerInput/utils";
import LinkHoverCard from "@src/components/MarkDown/LinkHoverCard";
import { PILL_SIZE } from "@src/config/pillTokens";
import SharedSessionFileLink from "@src/features/Org2Cloud/SharedSessionFileLink";
import { useOpenSessionSharedFile } from "@src/features/Org2Cloud/SharedSessionFilesContext";
import { parseSharedSessionFileReference } from "@src/features/Org2Cloud/sharedSessionFileReference";
import { AtIcon, HugeiconsIcon } from "@src/icons";
import { activeWorkspaceRootAtom } from "@src/store/workspace";
import { openLink } from "@src/util/ui/openLink";

import { type MentionSegment, type PillSegment } from "./userMessageSegments";

const ICON_PROPS = { size: PILL_SIZE.iconSize, strokeWidth: 1.75 } as const;

export const InlineReferenceLink: React.FC<{ segment: PillSegment }> = memo(
  ({ segment }) => {
    const openSharedFile = useOpenSessionSharedFile();
    const activeWorkspaceRoot = useAtomValue(activeWorkspaceRootAtom);
    const href = resolvePostedReferenceHref(
      segment.path,
      segment.pillType,
      segment.terminalText
    );
    const isWebReference = /^https?:\/\//iu.test(href);
    const isFileReference =
      segment.pillType === "file" || segment.pillType === "folder";
    const handleClick = useCallback(
      (e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (isWebReference) {
          openLink(href);
          return;
        }

        if (segment.pillType === "terminal") {
          let sessionId: string;
          if (segment.path.startsWith("terminal://")) {
            const parts = segment.path.replace("terminal://", "").split("/");
            sessionId = parts[0];
          } else {
            sessionId = segment.path;
          }

          const terminalText =
            segment.terminalText ??
            window.__orgiiTerminalPillTexts?.[segment.path] ??
            undefined;

          document.dispatchEvent(
            new CustomEvent("terminal-pill-click", {
              detail: {
                sessionId,
                fileName: segment.displayName,
                terminalText,
              },
            })
          );
          return;
        }

        if (
          segment.pillType === "paste" ||
          segment.pillType === "dom-component"
        ) {
          // Route to the dedicated DomComponentPreview tab (Raw / Preview viewer).
          const pasteText =
            segment.terminalText ??
            window.__orgiiTerminalPillTexts?.[segment.path] ??
            "";
          document.dispatchEvent(
            new CustomEvent("dom-component-preview-click", {
              detail: {
                pasteId: segment.path,
                fileName: segment.displayName,
                jsonText: pasteText,
              },
            })
          );
          return;
        }

        if (isFileReference) {
          if (segment.pillType === "file" && openSharedFile(segment.path))
            return;
          document.dispatchEvent(
            new CustomEvent("file-pill-click", {
              detail: {
                filePath: segment.path,
                fileName: segment.displayName,
                isFolder: segment.pillType === "folder",
              },
            })
          );
        }
      },
      [href, isFileReference, isWebReference, segment, openSharedFile]
    );

    const sharedFile = parseSharedSessionFileReference(segment.path);
    if (sharedFile)
      return (
        <SharedSessionFileLink href={segment.path} reference={sharedFile}>
          {segment.displayName}
        </SharedSessionFileLink>
      );
    if (!isSafePostedReferenceHref(href)) {
      return <span>{segment.displayName}</span>;
    }

    const pill = (
      <BasePill
        variant="editor"
        // `group` scopes the hover underline below to the words alone, leaving
        // the icon unmarked.
        className="group"
        iconNode={
          segment.pillType === "link"
            ? null
            : renderPillIcon(
                segment.pillType,
                segment.path,
                segment.displayName,
                segment.pillType === "folder"
              )
        }
        style={{
          position: "relative",
          zIndex: 1,
          userSelect: "none",
          WebkitUserSelect: "none",
          // A full GitHub label may wrap rather than overflow the bubble.
          ...(isGitHubPillUrl(href)
            ? {
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                maxWidth: "100%",
              }
            : null),
        }}
        title={isWebReference ? undefined : href}
        onClick={handleClick}
        // A pill is a span, so the link affordance the old anchor carried has
        // to be stated for assistive tech and keyboard users.
        role="link"
        tabIndex={0}
        aria-label={`${segment.displayName} (${href})`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") handleClick(event);
        }}
      >
        <span className="underline-offset-2 group-hover:underline">
          {segment.pillType === "link"
            ? truncateVisibleLinkLabel(segment.displayName)
            : isGitHubPillUrl(href)
              ? segment.displayName
              : truncateVisiblePillLabel(segment.displayName)}
        </span>
      </BasePill>
    );

    // A web reference gets the same hover card links carry everywhere else —
    // the pull-request / issue summary for GitHub targets, the host card
    // otherwise. `LinkHoverCard` returns the pill untouched for anything it
    // cannot preview, so non-web references simply keep their tooltip.
    return (
      <LinkHoverCard
        url={href}
        workspaceRootPath={activeWorkspaceRoot?.path ?? ""}
        workspaceRootRepoId={activeWorkspaceRoot?.repoId}
        workspaceRootRepoUrl={activeWorkspaceRoot?.repo?.repo_url}
      >
        {pill}
      </LinkHoverCard>
    );
  }
);
InlineReferenceLink.displayName = "InlineReferenceLink";

export const MentionPill: React.FC<{ segment: MentionSegment }> = memo(
  function MentionPill({ segment }) {
    return (
      <BasePill
        variant="editor"
        iconNode={
          <HugeiconsIcon icon={AtIcon} data-icon="at-sign" {...ICON_PROPS} />
        }
        style={{
          position: "relative",
          zIndex: 1,
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        title={segment.displayName}
      >
        <span>{segment.displayName}</span>
      </BasePill>
    );
  }
);
