/**
 * ComposerPill
 *
 * Atomic, non-editable inline pill rendered inside the ComposerInput
 * `contenteditable` host. The wrapping `<span>` uses `contenteditable="false"`
 * so the browser treats the entire pill as a single insertion point — caret
 * navigation, selection, and Backspace/Delete operate on the whole node.
 *
 * Mirrors the inline context-pill visual + hover-preview behavior without
 * relying on a rich text editor framework.
 */
import { useAtomValue } from "jotai";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import GitHubPillIcon from "@src/assets/modelIcons/github-pill.svg";
import AnyIcon from "@src/components/AnyIcon";
import FileTreePreview from "@src/components/FileTreePreview";
import FileTypeIcon from "@src/components/FileTypeIcon";
import LinkHoverCard from "@src/components/MarkDown/LinkHoverCard";
import Tooltip from "@src/components/Tooltip";
import { PILL_SIZE, readPillText } from "@src/config/pillTokens";
import {
  AtIcon,
  Cancel01Icon,
  CodeXmlIcon,
  ComputerTerminal01Icon,
  Cursor02Icon,
  DeliveryBox01Icon,
  GitPullRequestIcon,
  HugeiconsIcon,
  InternetIcon,
  Link01Icon,
  ListChecksIcon,
  SquareMousePointerIcon,
  ToolboxIcon,
  WorkflowCircle05Icon,
} from "@src/icons";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { activeWorkspaceRootAtom } from "@src/store/workspace";
import { resolveSessionRowIcon } from "@src/util/session/sessionSidebarRow";
import { openLink } from "@src/util/ui/openLink";

import BasePill from "./BasePill";
import CanvasCommandPillIcon, {
  isCanvasCommandPillPath,
} from "./CanvasCommandPillIcon";
import { isGitHubPillUrl } from "./githubUrl";
import type { ComposerPillAttrs, PillIconType } from "./types";
import { truncateVisibleLinkLabel, truncateVisiblePillLabel } from "./utils";

/**
 * Lets an untruncated label break across lines instead of pushing past the
 * composer's edge. The pill stays one inline atom for caret purposes; only the
 * text inside it wraps.
 */
const WRAPPING_LABEL_STYLE = {
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  maxWidth: "100%",
} as const;

const PREVIEW_SHOW_DELAY = 300;
const PREVIEW_HIDE_DELAY = 150;
const ICON_PROPS = { size: PILL_SIZE.iconSize, strokeWidth: 1.75 } as const;

function sessionIdFromPillPath(path: string): string {
  const withoutScheme = path.startsWith("session://")
    ? path.slice("session://".length)
    : path;
  return withoutScheme.split("::")[0].split("/")[0];
}

const SessionPillIcon: React.FC<{ path: string }> = memo(({ path }) => {
  const sessionId = sessionIdFromPillPath(path);
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const icon = useMemo(
    () => resolveSessionRowIcon(session ?? sessionId),
    [session, sessionId]
  );
  return <AnyIcon icon={icon} {...ICON_PROPS} />;
});
SessionPillIcon.displayName = "SessionPillIcon";

/** Heuristic for resolving plain file/folder references into folder icons. */
function isLikelyFolder(path: string, name: string): boolean {
  if (!path && !name) return false;
  if (path?.endsWith("/")) return true;
  const lower = (name || path?.split("/").pop() || "").toLowerCase();
  const folderNames = new Set([
    "node_modules",
    "src",
    "lib",
    "dist",
    "build",
    "public",
    "assets",
    "components",
    "hooks",
    "utils",
    "types",
    "styles",
    "pages",
    "features",
    "api",
    "store",
    "config",
    "tests",
    "__tests__",
    "__mocks__",
    ".git",
    ".vscode",
    ".idea",
  ]);
  return folderNames.has(lower);
}

export interface ComposerPillProps {
  attrs: ComposerPillAttrs;
  /** Absolute path to the skill directory when this pill references a skill. */
  skillPath?: string;
  /** Called when the user clicks the X icon to remove the pill */
  onDelete: () => void;
}

/**
 * The glyph a pill wears, resolved from its type. Exported so a reference keeps
 * the same face wherever it appears — inside the composer while writing, and
 * inside a sent message bubble afterwards. A pill that changed icon on send
 * would read as a different kind of thing than the one the user inserted.
 */
export function renderPillIcon(
  iconType: PillIconType | null,
  filePath: string,
  fileName: string,
  isFolder: boolean
): React.ReactNode {
  switch (iconType as PillIconType | null) {
    case "repo":
    case "pr":
    case "issue":
      if (isGitHubPillUrl(filePath)) {
        return (
          <GitHubPillIcon
            width={PILL_SIZE.iconSize}
            height={PILL_SIZE.iconSize}
            className="text-primary-6"
          />
        );
      }
      if (iconType === "repo")
        return (
          <HugeiconsIcon icon={CodeXmlIcon} data-icon="code" {...ICON_PROPS} />
        );
      if (iconType === "pr")
        return (
          <HugeiconsIcon
            icon={GitPullRequestIcon}
            data-icon="git-pull-request"
            {...ICON_PROPS}
          />
        );
      return (
        <HugeiconsIcon
          icon={ListChecksIcon}
          data-icon="list-checks"
          {...ICON_PROPS}
        />
      );
    case "branch":
      return (
        <HugeiconsIcon
          icon={WorkflowCircle05Icon}
          data-icon="git-branch"
          {...ICON_PROPS}
        />
      );
    case "terminal":
      return (
        <HugeiconsIcon
          icon={ComputerTerminal01Icon}
          data-icon="terminal"
          {...ICON_PROPS}
        />
      );
    case "session":
      return <SessionPillIcon path={filePath} />;
    case "browser":
      return (
        <HugeiconsIcon icon={InternetIcon} data-icon="globe" {...ICON_PROPS} />
      );
    case "link":
      return (
        <HugeiconsIcon icon={Link01Icon} data-icon="link" {...ICON_PROPS} />
      );
    case "project":
      return (
        <HugeiconsIcon
          icon={DeliveryBox01Icon}
          data-icon="box"
          {...ICON_PROPS}
        />
      );
    case "workitem":
      return (
        <HugeiconsIcon
          icon={ListChecksIcon}
          data-icon="list-checks"
          {...ICON_PROPS}
        />
      );
    case "dom-element":
      return (
        <HugeiconsIcon
          icon={SquareMousePointerIcon}
          data-icon="square-mouse-pointer"
          {...ICON_PROPS}
        />
      );
    case "dom-component":
      return (
        <HugeiconsIcon
          icon={Cursor02Icon}
          data-icon="mouse-pointer-2"
          {...ICON_PROPS}
        />
      );
    case "skill":
      if (isCanvasCommandPillPath(filePath)) {
        return <CanvasCommandPillIcon />;
      }
      return (
        <HugeiconsIcon icon={ToolboxIcon} data-icon="toolbox" {...ICON_PROPS} />
      );
    case "member":
      return (
        <HugeiconsIcon icon={AtIcon} data-icon="at-sign" {...ICON_PROPS} />
      );
    default:
      return (
        <FileTypeIcon
          fileName={isFolder ? filePath || fileName : fileName || filePath}
          type={isFolder ? "folder" : undefined}
          size="small"
        />
      );
  }
}

const ComposerPill: React.FC<ComposerPillProps> = ({
  attrs,
  skillPath,
  onDelete,
}) => {
  const {
    filePath,
    fileName,
    isFolder: isFolderAttr,
    iconType,
    lineStart,
    lineEnd,
  } = attrs;

  const activeWorkspaceRoot = useAtomValue(activeWorkspaceRootAtom);
  const [isHovered, setIsHovered] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ left: 0, top: 0 });

  const pillRef = useRef<HTMLSpanElement>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lineRangeDisplay = useMemo(() => {
    if (lineStart != null && lineEnd != null)
      return `(${lineStart}-${lineEnd})`;
    if (lineStart != null) return `(${lineStart})`;
    return null;
  }, [lineStart, lineEnd]);

  const isGenericLink = iconType === "link";
  /**
   * What hovering should reveal. A reference pill labelled with the link's own
   * words shows nothing about where it points, so the address belongs here —
   * the same affordance skill pills already use for their path.
   */
  const isReference =
    isGenericLink || iconType === "pr" || iconType === "issue";
  /** Web references get the hover card; everything else falls back to text. */
  const referenceUrl =
    isReference && /^https?:\/\//iu.test(filePath) ? filePath : "";
  const hoverDetail = referenceUrl
    ? null
    : iconType === "skill"
      ? skillPath
      : isReference
        ? filePath
        : null;
  // A parsed GitHub reference shows its whole label — "owner/repo#123" is the
  // information, and it may wrap onto the next line. Everything else
  // truncates: a pasted URL can run to hundreds of characters, and its full
  // address stays available on hover.
  const showsFullLabel = isGitHubPillUrl(filePath);
  const visibleFileName = useMemo(
    () =>
      isGenericLink
        ? truncateVisibleLinkLabel(fileName)
        : showsFullLabel
          ? fileName
          : truncateVisiblePillLabel(fileName),
    [fileName, isGenericLink, showsFullLabel]
  );

  const isFolder = useMemo(() => {
    if (iconType && iconType !== "folder") return false;
    if (iconType === "folder") return true;
    if (isFolderAttr === true) return true;
    return isLikelyFolder(filePath, fileName);
  }, [isFolderAttr, filePath, fileName, iconType]);

  const shouldShowTreePreview = useMemo(() => {
    return !iconType || iconType === "folder" || iconType === "file";
  }, [iconType]);

  const shouldShowPastePreview =
    iconType === "paste" || iconType === "dom-component";
  const shouldShowHoverPreview =
    shouldShowTreePreview || shouldShowPastePreview;

  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  const handlePillMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  const handlePillClick = useCallback(
    (event: React.MouseEvent) => {
      if (isGitHubPillUrl(filePath) || iconType === "link") {
        event.preventDefault();
        event.stopPropagation();
        openLink(filePath);
        return;
      }

      if ((event.target as HTMLElement).closest("svg")) return;

      if (iconType === "member") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (iconType === "terminal") {
        event.preventDefault();
        event.stopPropagation();
        let sessionId: string;
        if (filePath.startsWith("terminal://")) {
          sessionId = filePath.replace("terminal://", "").split("/")[0];
        } else {
          sessionId = filePath;
        }
        const terminalText =
          window.__orgiiTerminalPillTexts?.[filePath] ?? undefined;
        document.dispatchEvent(
          new CustomEvent("terminal-pill-click", {
            detail: { sessionId, fileName, terminalText },
            bubbles: true,
          })
        );
        return;
      }

      if (iconType === "paste" || iconType === "dom-component") {
        event.preventDefault();
        event.stopPropagation();
        // Paste pills carry an inline JSON blob captured from the page.
        // Route them to the dedicated DomComponentPreview tab which offers
        // Raw / Preview toggle, instead of reusing the terminal-content tab.
        const pasteText = window.__orgiiTerminalPillTexts?.[filePath] ?? "";
        document.dispatchEvent(
          new CustomEvent("dom-component-preview-click", {
            detail: {
              pasteId: filePath,
              fileName,
              jsonText: pasteText,
            },
            bubbles: true,
          })
        );
        return;
      }

      document.dispatchEvent(
        new CustomEvent("file-pill-click", {
          detail: { filePath, fileName, lineStart, lineEnd, isFolder },
          bubbles: true,
        })
      );
    },
    [filePath, fileName, lineStart, lineEnd, isFolder, iconType]
  );

  const updatePreviewPosition = useCallback(() => {
    if (!pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();
    setPreviewPosition({ left: rect.left, top: rect.top - 4 });
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (!shouldShowHoverPreview) return;
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    showTimeoutRef.current = setTimeout(() => {
      updatePreviewPosition();
      setShowPreview(true);
    }, PREVIEW_SHOW_DELAY);
  }, [shouldShowHoverPreview, updatePreviewPosition]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, PREVIEW_HIDE_DELAY);
  }, []);

  const handlePreviewMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handlePreviewMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, PREVIEW_HIDE_DELAY);
  }, []);

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const iconNode = isGenericLink ? null : isHovered ? (
    <HugeiconsIcon
      icon={Cancel01Icon}
      data-icon="x"
      size={PILL_SIZE.iconSize}
      strokeWidth={2}
      onClick={handleDelete}
      // Removal is the one destructive thing a pill offers, so the glyph turns
      // danger under the cursor — it sits where the icon was, and nothing else
      // distinguishes hovering the pill from hovering its remove control.
      className="text-text-3 hover:text-danger-6"
      style={{ cursor: "var(--interactive-cursor, default)" }}
    />
  ) : (
    renderPillIcon(
      iconType as PillIconType | null,
      filePath,
      fileName,
      isFolder
    )
  );

  const pillNode = (
    <BasePill
      variant="editor"
      iconNode={iconNode}
      pillRef={pillRef}
      className="composer-pill"
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: "var(--interactive-cursor, default)",
        backgroundColor: "transparent",
        outline: "none",
        ...(showsFullLabel ? WRAPPING_LABEL_STYLE : null),
      }}
      onClick={handlePillClick}
      onMouseDown={handlePillMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={hoverDetail || referenceUrl ? undefined : fileName}
    >
      <span className="composer-pill-label">{visibleFileName}</span>
      {lineRangeDisplay && (
        <span style={{ color: "var(--color-text-3)", fontSize: "12px" }}>
          {lineRangeDisplay}
        </span>
      )}
    </BasePill>
  );

  const pillWithTooltip = referenceUrl ? (
    // The same card a link carries everywhere else in the app: the
    // pull-request / issue summary for GitHub targets, the host card
    // otherwise. A plain address is a poor preview of a reference.
    <LinkHoverCard
      url={referenceUrl}
      workspaceRootPath={activeWorkspaceRoot?.path ?? ""}
      workspaceRootRepoId={activeWorkspaceRoot?.repoId}
      workspaceRootRepoUrl={activeWorkspaceRoot?.repo?.repo_url}
    >
      {pillNode}
    </LinkHoverCard>
  ) : hoverDetail ? (
    <Tooltip
      content={<span className="break-all">{hoverDetail}</span>}
      position="top"
      kind="button"
      framedPanel
      smartPlacement
    >
      {pillNode}
    </Tooltip>
  ) : (
    pillNode
  );

  return (
    <>
      {pillWithTooltip}

      {showPreview &&
        shouldShowTreePreview &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: previewPosition.left,
              top: previewPosition.top,
              transform: "translateY(-100%)",
              zIndex: 9999,
            }}
            onMouseEnter={handlePreviewMouseEnter}
            onMouseLeave={handlePreviewMouseLeave}
          >
            <FileTreePreview
              path={filePath}
              itemType={isFolder ? "folder" : "file"}
              width="auto"
            />
          </div>,
          document.body
        )}

      {showPreview &&
        shouldShowPastePreview &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: previewPosition.left,
              top: previewPosition.top,
              transform: "translateY(-100%)",
              zIndex: 9999,
            }}
            onMouseEnter={handlePreviewMouseEnter}
            onMouseLeave={handlePreviewMouseLeave}
          >
            <PastePillPreview filePath={filePath} fileName={fileName} />
          </div>,
          document.body
        )}
    </>
  );
};

const PASTE_PREVIEW_MAX_LINES = 16;
const PASTE_PREVIEW_MAX_CHARS = 1200;

const PastePillPreview: React.FC<{ filePath: string; fileName: string }> = memo(
  ({ filePath, fileName }) => {
    const fullText = readPillText(filePath) ?? "";
    const lines = fullText.split("\n");
    const truncated =
      lines.length > PASTE_PREVIEW_MAX_LINES ||
      fullText.length > PASTE_PREVIEW_MAX_CHARS;
    const headLines = lines
      .slice(0, PASTE_PREVIEW_MAX_LINES)
      .join("\n")
      .slice(0, PASTE_PREVIEW_MAX_CHARS);

    return (
      <div
        className="overflow-hidden rounded-[8px] border border-solid border-border-2 bg-bg-2 shadow-md"
        style={{ width: "min(420px, 60vw)" }}
      >
        <div className="flex items-center justify-between border-0 border-b border-solid border-border-2 px-3 py-1.5 text-[10px] font-medium tracking-wide text-text-3 uppercase">
          <span className="truncate">{fileName}</span>
          <span className="ml-2 shrink-0 text-text-3 normal-case">
            {lines.length} lines · click to open
          </span>
        </div>
        <pre
          className="m-0 max-h-[280px] overflow-hidden px-3 py-2 text-[11px] leading-snug whitespace-pre text-text-2"
          style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
        >
          {headLines}
          {truncated ? "\n…" : ""}
        </pre>
      </div>
    );
  }
);
PastePillPreview.displayName = "PastePillPreview";

export default ComposerPill;
