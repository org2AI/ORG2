/**
 * Renderer extension slots for the Markdown component.
 *
 * `components/MarkDown/` is a tier-1 primitive: 51 files across 12 areas
 * render through it, so it may not import ChatPanel, Org2Cloud, CodeMirror or
 * the scaffold overlay stack. Those tiers own genuine *extensions* of the
 * renderer (chat code-block chrome, canvas fences, cloud session references,
 * the Prism palette, the image lightbox). Each is declared here as a named
 * slot with a plain built-in default and registered from the owning tier at
 * app bootstrap, so the dependency points down instead of up.
 *
 * Every slot is optional. An unregistered slot renders the plain default —
 * a Markdown block never blanks or throws because nobody registered.
 */
import type React from "react";

import type { CanvasFencedMode } from "../markdownCodeFence";

/** Canvas fence modes the inline-card slot understands. */
export type MarkdownCanvasMode = CanvasFencedMode;

export interface MarkdownChatCodeBlockProps {
  code: string;
  language: string;
  filePath?: string;
  title?: string;
  subtitle?: string;
  maxHeight?: number;
  containerWidth?: number;
  showLineNumbers?: boolean;
  showLineCount?: boolean;
  hideHeader?: boolean;
  showOpenButton?: boolean;
}

export interface MarkdownCanvasCardProps {
  mode: MarkdownCanvasMode;
  content?: string;
  url?: string;
  title?: string;
}

export interface MarkdownImageOverlayProps {
  dataUrl: string;
  fileName?: string;
  originalRef?: string;
  onClose: () => void;
}

/** Header chrome for a self-contained markdown block (currently Mermaid). */
export interface MarkdownBlockHeaderProps {
  title: string;
  icon: React.ReactNode;
  isCollapsed: boolean;
  isHeaderHovered: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  rightContent?: React.ReactNode;
}

export interface MarkdownBlockChrome {
  /** Container classes the host surface uses for its own event blocks. */
  containerClassName: () => string;
  Header: React.ComponentType<MarkdownBlockHeaderProps>;
}

/**
 * Session/file attachments projected out of the source text.
 *
 * The payloads are opaque here: they travel from `project` straight back into
 * `render`, both owned by the registering tier, so the renderer never needs
 * the domain type.
 */
export interface MarkdownAttachmentProjection {
  /** Source text with the projected references removed. */
  text: string;
  attachments: readonly unknown[];
  /** True when the source carried only references and whitespace. */
  referenceOnly: boolean;
}

export interface MarkdownAttachmentsSlot {
  project: (source: string) => MarkdownAttachmentProjection;
  render: (attachments: readonly unknown[]) => React.ReactNode;
}

/** Prism token → style map (`react-syntax-highlighter`'s `style` prop). */
export type MarkdownSyntaxTheme = Record<string, React.CSSProperties>;

/** A remark plugin, opaque to the renderer (it only forwards the list). */
export type MarkdownRemarkPlugin = unknown;

export interface MarkdownExtensions {
  /** Chat-flavoured fenced code block (collapsible, scrollable, openable). */
  ChatCodeBlock?: React.ComponentType<MarkdownChatCodeBlockProps>;
  /** Inline canvas/preview card for canvas-* fences. */
  CanvasInlineCard?: React.ComponentType<MarkdownCanvasCardProps>;
  /** Full-screen preview for a local image the renderer decoded. */
  ImageOverlay?: React.ComponentType<MarkdownImageOverlayProps>;
  /** Block header chrome shared with the host surface's own event blocks. */
  blockChrome?: MarkdownBlockChrome;
  /** Syntax palette for highlighted fences. */
  syntaxTheme?: MarkdownSyntaxTheme;
  /**
   * Render a domain reference href (cloud session, shared session file).
   * Returns null when the href is not one, so the plain link path continues.
   */
  renderReferenceLink?: (
    href: string,
    children: React.ReactNode
  ) => React.ReactNode | null;
  /** True when `href` is a domain reference `renderReferenceLink` handles. */
  ownsReferenceHref?: (href: string) => boolean;
  /** Extra remark plugins (e.g. linkifying bare domain references). */
  remarkPlugins?: readonly MarkdownRemarkPlugin[];
  /** Projection + rendering of session attachment cards below the prose. */
  sessionAttachments?: MarkdownAttachmentsSlot;
}
