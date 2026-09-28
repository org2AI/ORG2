# SettingsTable rows UI audit

| Line                | Element                           | Verdict          | Reason                                                                                                                                     | Suggested change |
| ------------------- | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `TableBody.tsx:232` | Native table row and cells        | keep with reason | Semantic table markup preserves column alignment and screen reader table navigation; there is no shared table-row primitive to replace it. | None.            |
| `TableBody.tsx:244` | Focusable expandable settings row | keep with reason | Removing the visible disclosure button requires a keyboard path on the row that still exposes expansion state.                             | None.            |
| `TableBody.tsx:270` | Non-settings expand button        | keep with reason | The ordinary Table presentation still needs its explicit control, and it uses the shared `Button`.                                         | None.            |
| `index.scss:534`    | Row focus outline                 | keep with reason | The outline uses the shared primary token and makes the keyboard target visible.                                                           | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.
