# KeyVault variant controls UI audit

Batch: the consolidated key/model rows and the variant controls that replaced
the left/right split in the KeyVault expanded cards.

Files audited: `ModelVariantInlineCard.tsx`, `ModelVariantGrid.tsx`,
`InlineSplitRows.tsx`, `InlineCardPrimitives.tsx`,
`ModelInlineExpandedCard.tsx`, `AccountModelsInlineSplit.tsx`.

## D1 — Raw HTML vs design system

| Line                             | Element              | Verdict          | Reason                                                                                                                                                     | Suggested change |
| -------------------------------- | -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ModelVariantInlineCard.tsx:177` | Options trigger pill | keep with reason | Shared `Button` with `layout="custom"`; a pill surface (rounded-full, token border that flips to `primary-6` when open) the standard sizes do not express. | None.            |
| `ModelVariantInlineCard.tsx:206` | Fast toggle          | keep with reason | Shared `Button` with `layout="custom"` + `aria-pressed`; 28px square toggle matching the pill row height.                                                  | None.            |
| `ModelVariantGrid.tsx:328`       | Variant pill         | keep with reason | Shared `Button` with `layout="custom"`; same pill family as above, selected state carried by `aria-pressed`.                                               | None.            |
| `InlineSplitRows.tsx:67`         | Key row container    | keep with reason | Plain `<div>`: the row is no longer clickable (selection was removed), so it carries no interactive semantics of its own.                                  | None.            |
| `ModelVariantInlineCard.tsx:160` | Options dropdown     | keep with reason | Shared `Dropdown` in droplist mode with `DROPDOWN_CLASSES.panel`; portaled to `document.body` because the card clips and scrolls.                          | None.            |

## D2 — Arbitrary Tailwind values vs tokens

| Line                             | Element            | Verdict          | Reason                                                                                                                   | Suggested change                                                                                            |
| -------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ModelVariantInlineCard.tsx:34`  | `w-[168px]` slider | keep with reason | One-off layout number: the width that fits 6 effort stops without stretching the row. Named constant, single use.        | None.                                                                                                       |
| `ModelVariantInlineCard.tsx:180` | `max-w-[160px]`    | keep with reason | Truncation budget for the longest variant label (`Extra High · Thinking · Fast`), paired with the slider width above.    | None.                                                                                                       |
| `ModelVariantInlineCard.tsx:171` | `min-w-[260px]`    | keep with reason | Matches `MODEL_PROPERTIES_PANEL_WIDTH` (260) used by the sibling model-properties popover, so both panels read alike.    | None.                                                                                                       |
| `InlineCardPrimitives.tsx:47`    | `max-h-[360px]`    | keep with reason | Carried over verbatim from `InlineExpandedSplitCard`'s scroll region so the consolidated list scrolls at the same point. | None.                                                                                                       |
| `h-[28px]` / `text-[12px]`       | Pill geometry      | watch            | 3 sites across 2 files, but all three are the same pill family and two already share `PILL_CLASS`.                       | Confirm by a third consumer outside these files; then promote `PILL_CLASS` to the shared ModelTable config. |

## D3 — Hardcoded sizes / colors

No literal hex or rgb values. Every color is a token (`border-border-2`,
`text-text-2`, `text-text-3`, `bg-border-2`, `border-primary-6`,
`text-primary-6`, `hover:bg-fill-2`). Verdict: **0 fix**.

## D4 — Accessibility basics

| Line                              | Element         | Verdict          | Reason                                                                                                           | Suggested change |
| --------------------------------- | --------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ModelVariantInlineCard.tsx:178`  | Options trigger | keep with reason | `aria-label` + `aria-expanded` wired to the controlled `popupVisible`; `Dropdown` owns Escape and outside-click. | None.            |
| `ModelVariantInlineCard.tsx:207`  | Fast toggle     | keep with reason | Icon-only, so it carries `aria-label` and `aria-pressed`, plus a tooltip for sighted users.                      | None.            |
| `ModelVariantInlineCard.tsx:191`  | Separator       | keep with reason | Decorative 1px rule, `aria-hidden="true"`.                                                                       | None.            |
| `ModelInlineExpandedCard.tsx:350` | Master switch   | keep with reason | Shared `Switch` inside a `Tooltip kind="button"`; the tooltip states which family it turns on or off.            | None.            |

## D5 — Repeated visual / structural patterns

| Pattern                         | Occurrences                                               | Verdict      | Reason                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consolidated list inside a card | 2 (`ModelInlineExpandedCard`, `AccountModelsInlineSplit`) | fix (landed) | Both cards rebuilt the same shell. Extracted as `InlineCardScrollList` + `InlineSplitKeyRow`, with `wrapInCard` for the pane that already sits in a panel. |
| Effort × speed grid             | 2 (row dropdown, read-only catalog)                       | fix (landed) | The grid was inlined in the card component. Extracted to `ModelVariantGrid` and shared by both consumers.                                                  |
| Variant pill surface            | 3                                                         | watch        | See D2. Two sites already share `PILL_CLASS` inside one file; the third lives in the grid. One more consumer justifies a shared token.                     |

## Removed during this batch

`InlineSplitSelectableRow` and `InlineSplitDefaultVersionHeaderRow` lost their
last consumers when the split panes were consolidated, and were deleted rather
than left as dead design-system surface area. `InlineSplitHeaderRow` lost its
`padded` prop for the same reason.

Verdict totals: **0 fix outstanding** (2 fixed in this batch), **12 keep with reason**, **0 abstract**, **1 watch**.
