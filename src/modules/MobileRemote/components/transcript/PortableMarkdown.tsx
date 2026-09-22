import React, { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "@src/components/MarkDown/index.scss";

import { PortableCodeBlock } from "./PortableCodeBlock";

export interface PortableMarkdownProps {
  textContent: string;
  streaming?: boolean;
}

/**
 * Browser-safe subset of the desktop session Markdown renderer.
 *
 * The syntax and stylesheet match desktop chat, while desktop-only actions
 * (Tauri file opening, hover previews, Mermaid and canvas blocks) stay out of
 * the public mobile bundle.
 */
const PortableMarkdown: React.FC<PortableMarkdownProps> = memo(
  ({ textContent, streaming = false }) => {
    const components = useMemo(
      () => ({
        pre: ({ children }: { children?: React.ReactNode }) => {
          const child = React.Children.toArray(children)[0];
          if (
            !React.isValidElement<{
              children?: React.ReactNode;
              className?: string;
            }>(child)
          )
            return <pre>{children}</pre>;
          return (
            <PortableCodeBlock
              code={String(child.props.children ?? "").replace(/\n$/, "")}
              language={
                /language-([^\s]+)/.exec(child.props.className ?? "")?.[1] ??
                "text"
              }
              streaming={streaming}
            />
          );
        },
      }),
      [streaming]
    );
    return (
      <ReactMarkdown
        className="chat-markdown-body"
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {textContent}
      </ReactMarkdown>
    );
  }
);

PortableMarkdown.displayName = "PortableMarkdown";

export default PortableMarkdown;
