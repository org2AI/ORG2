import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";

import MarkdownTable from "./MarkdownTable";
import { splitIntoStableMarkdownBlocks } from "./markdownStableBlocks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "Table" }),
}));

const source = [
  "A complete response.",
  "",
  "| 维度 | Codex | 当前实现 |",
  "| :--- | :---: | ---: |",
  "| 指令写法 | Clear instructions | 完整内容 |",
  "| 常用分层 | `docs` and `schema` | 第二行 |",
  "| 接口 | [Docs](https://example.com/docs) | 第三行 |",
  "| 绑定 | workspace | 第四行 |",
  "| 外部接入 | Skills / MCP | 第五行 |",
  "| 终端语义 | escaped \\| pipe | **最后一行** |",
].join("\n");

function render(content: string) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: {
          table: ({ node: _node, ...props }) =>
            createElement(MarkdownTable, props),
        },
      },
      content
    )
  );
}

describe("MarkdownTable", () => {
  it("keeps all cells, formatting and GFM alignment inside a keyboard-scrollable region", () => {
    const html = render(source);
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Table"');
    expect(html).toContain('tabindex="0"');
    expect(html.match(/<tr>/g)).toHaveLength(7);
    expect(html.match(/<td[ >]/g)).toHaveLength(18);
    expect(html).toContain(
      '<td style="text-align:right"><strong>最后一行</strong></td>'
    );
    expect(html).toContain("escaped | pipe");
    expect(html).toContain("<code>schema</code>");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).not.toContain("node=");
  });

  it("renders the complete table after a stream first ends inside its first cell", () => {
    const cutoff = source.indexOf("指令写法") + 2;
    const partial = splitIntoStableMarkdownBlocks(source.slice(0, cutoff))
      .map(render)
      .join("");
    expect(partial).not.toContain("最后一行");
    const complete = splitIntoStableMarkdownBlocks(source).map(render).join("");
    expect(complete.match(/<tr>/g)).toHaveLength(7);
    expect(complete).toContain("最后一行");
    expect(render(source)).toContain("最后一行");
  });
});
