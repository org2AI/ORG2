/**
 * MarkdownCodeBlock
 *
 * The default (non-chat) fenced code block: source with a copy button and, for
 * references inside the active repo, an open-in-editor button. Memoized on its
 * own props so streaming text does not re-highlight completed blocks.
 *
 * Syntax colouring is the one lazy boundary left in the Markdown tree: the
 * grammar set is heavy and purely cosmetic, so the code renders as plain text
 * first and gains colour when `MarkdownCodeHighlighter` arrives. If that chunk
 * never arrives, the fence still shows its code.
 */
import React, { Suspense, lazy, memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useCopyCheck } from "@src/hooks/ui/useCopyCheck";
import { copyText } from "@src/util/data/clipboard";
import { openFileInWorkStation } from "@src/util/ui/openFileInWorkStation";

import { CodeBlockToolbar } from "./CodeBlockToolbar";
import { MarkdownFallbackBoundary } from "./MarkdownFallbackBoundary";

const MarkdownCodeHighlighter = lazy(
  () =>
    import(
      /* webpackChunkName: "markdown-code-highlighter" */ "./MarkdownCodeHighlighter"
    )
);

// ============================================
// Static Styles (moved outside component for performance)
// ============================================

const CODE_PLAIN_STYLE: React.CSSProperties = {
  fontFamily: "var(--cm-font-family)",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: 0,
  padding: "12px 14px",
  borderRadius: "8px",
  background: "transparent",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const CODE_WRAPPER_STYLE: React.CSSProperties = {
  border: "none",
  borderRadius: "8px",
  margin: "8px 0",
};

interface CodeBlockProps {
  children: string;
  language: string;
  startLine?: string;
  openFilePath?: string;
}

const CodeBlock = memo<CodeBlockProps>(
  ({ children, language, startLine, openFilePath }) => {
    const onCopyContent = useCallback(async () => {
      await copyText(children);
    }, [children]);
    const { copied, handleCopy } = useCopyCheck(onCopyContent);
    const { t } = useTranslation("common");

    const handleOpenFile = useCallback(() => {
      if (!openFilePath) return;
      const line = startLine ? Number.parseInt(startLine, 10) : undefined;
      openFileInWorkStation(openFilePath, {
        line: Number.isFinite(line) ? line : undefined,
      });
    }, [openFilePath, startLine]);

    const copyLabel = copied ? t("status.copied") : t("actions.copy");
    const openLabel = t("actions.open");

    // Shown while the grammar chunk loads and if it fails: same text, same
    // metrics, no colour. `language-*` keeps the fence's CSS hooks intact.
    const plainCode = (
      <div style={CODE_PLAIN_STYLE}>
        <code className={`language-${language}`}>{children}</code>
      </div>
    );

    return (
      <div className="code-block-wrapper" style={CODE_WRAPPER_STYLE}>
        <CodeBlockToolbar
          copyLabel={copyLabel}
          copied={copied}
          onCopy={handleCopy}
          openLabel={openLabel}
          onOpen={openFilePath ? handleOpenFile : undefined}
        />
        <MarkdownFallbackBoundary
          label="Markdown code highlighter"
          resetKey={children}
          fallback={plainCode}
        >
          <Suspense fallback={plainCode}>
            <MarkdownCodeHighlighter code={children} language={language} />
          </Suspense>
        </MarkdownFallbackBoundary>
      </div>
    );
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.language === next.language &&
    prev.startLine === next.startLine &&
    prev.openFilePath === next.openFilePath
);
CodeBlock.displayName = "CodeBlock";

export default CodeBlock;
