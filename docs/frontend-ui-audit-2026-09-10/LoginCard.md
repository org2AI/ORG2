# Login card UI audit

| Line                                     | Element     | Verdict          | Reason                                                                                                                             | Suggested change |
| ---------------------------------------- | ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| src/modules/AppLogin/LoginCard.tsx:16    | Login shell | keep with reason | Preserves the existing single-column login dimensions, shadow and shared content-width token while removing unused layout variants | None             |
| src/modules/AppLogin/LoginArtwork.tsx:63 | Artwork     | keep with reason | Existing login-only media retained under explicit ownership; white logo overlay intentionally contrasts with video                 | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.
