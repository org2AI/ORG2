# Spotlight pinning UI audit

Scope: new pin control, main Spotlight integration, working-directory palette integration. Existing unrelated row styling is unchanged.

| Line                                                                          | Element                          | Verdict          | Reason                                                                                                                                                                                                                              | Suggested change |
| ----------------------------------------------------------------------------- | -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/GlobalSpotlight/components/SpotlightItemRow.tsx:493`            | Hover pin control                | keep with reason | Uses the shared Button, sidebar sizing, theme color tokens, existing translated Pin/Unpin labels, and aria-pressed. Appears directly after the label; keyboard focus reveals it. Click and activation keys do not activate the row. | None             |
| `src/scaffold/GlobalSpotlight/hooks/features/useSpotlightItems.ts:511`        | Main pinned section              | keep with reason | Uses the existing item/header renderer and list navigation; stable command identities deduplicate Recent entries.                                                                                                                   | None             |
| `src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette/index.tsx:508` | Working-directory pinned section | keep with reason | Shares the same projection and row control; respects search results and disables pinning in add/manage mode. Existing current-selection metadata survives the move.                                                                 | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Validation: rendered jsdom row tests cover button placement, click isolation, activation-key propagation and pinned accessibility state. No desktop UI control or screenshots were used, per user preference. Real visual hover, themes and viewport appearance remain unverified.
