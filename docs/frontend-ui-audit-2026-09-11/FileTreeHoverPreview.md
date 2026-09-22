# FileTreeHoverPreview UI audit

| Line                                                        | Element              | Verdict          | Reason                                                                                                 | Suggested change |
| ----------------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/components/FileTreePreview/config.ts:6`                | Hover delay          | keep with reason | One shared 500 ms default implements the requested timing without duplicating timers at callers        | None             |
| `src/components/MarkDown/MarkdownFilePathHoverCard.tsx:28`  | Markdown file card   | keep with reason | Retains the shared card and inline anchor needed for paragraph wrapping, and inherits the shared delay | None             |
| `src/engines/ChatPanel/blocks/EventFileHoverPreview.tsx:21` | Tool-event file card | keep with reason | Retains the shared card and existing shared-session gate, and inherits the shared delay                | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.
