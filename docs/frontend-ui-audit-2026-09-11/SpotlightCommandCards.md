# Spotlight command cards UI audit

Scope: GUI/TUI presentation for the main command list. GUI hides breadcrumbs as requested while retaining the underlying navigation path; other palettes retain their existing controls.

| Line                                                                  | Element            | Verdict          | Reason                                                                                                                                                                                                              | Suggested change |
| --------------------------------------------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/GlobalSpotlight/components/SpotlightCommandView.tsx:34` | Footer view switch | keep with reason | Uses `ShellFooterAction` and the shared `SegmentedTextPill`, with localized group label and pressed state                                                                                                           | None             |
| `src/scaffold/GlobalSpotlight/components/SpotlightItemRow.tsx:378`    | Interactive card   | keep with reason | Reuses the existing row activation, disabled state, metadata, shortcuts and hover details; cards expose button semantics and Enter/Space activation                                                                 | None             |
| `src/scaffold/GlobalSpotlight/components/SpotlightCardList.tsx:12`    | Fixed card height  | keep with reason | One local geometry constant coordinates card height and virtual row estimates; compact 56px cards use single-line labels with full-title tooltips                                                                   | None             |
| `src/scaffold/GlobalSpotlight/components/SpotlightItemRow.tsx:401`    | Card appearance    | keep with reason | Existing border, background, text, radius and shadow tokens support themes; the compact horizontal layout places icon and label side by side; disclosure arrows overlay the corner on hover without consuming space | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Visual inspection in the running desktop app was not performed: user-wide instructions require explicit computer-control opt-in. Automated DOM tests cover behavior, not rendered geometry or theme appearance.
