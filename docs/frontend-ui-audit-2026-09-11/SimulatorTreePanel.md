# SimulatorTreePanel UI audit

| Line                                                                                     | Element              | Verdict          | Reason                                                                                                                                                                                            | Suggested change |
| ---------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/WorkStation/CodeEditor/SessionReplay/components/SimulatorTreePanel.tsx:123` | File-path hover card | keep with reason | Reuses `FileTreePreview` inside the existing smart-positioned `Tooltip`, with the shared 500 ms delay; the outer tooltip is transparent and unpadded so only the existing card supplies its frame | None             |
| `src/modules/WorkStation/CodeEditor/SessionReplay/components/SimulatorTreePanel.tsx:90`  | File row             | keep with reason | Retains `TreeRowBase` selection and click behavior; the existing tooltip trigger preserves the full-width row                                                                                     | None             |
| `src/modules/WorkStation/CodeEditor/SessionReplay/FileSidebar.tsx:425`                   | Terminal sections    | keep with reason | Commands and Other Tools explicitly disable file-path previews as requested; their tree paths are synthetic event IDs, not filesystem paths                                                       | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Scope: changed hover composition. The existing Tooltip's smart placement is retained. Desktop viewport-edge appearance was not visually verified because computer control was not authorized.
