# CLI update notice UI audit

| Line                                | Element           | Verdict          | Reason                                                                                                                                                                    | Suggested change |
| ----------------------------------- | ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `PageNotice/index.tsx:276`          | Title suffix      | keep with reason | The shared notice retains its title typography while `font-normal` gives secondary version details the requested weight. No new surface, color, or control is introduced. | None             |
| `ChatPanelCliVersionWarning.tsx:38` | CLI update notice | keep with reason | It uses `PageNotice`, shared `Button`, and `RefreshButton`; the new version detail is passed through the shared title suffix.                                             | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.
