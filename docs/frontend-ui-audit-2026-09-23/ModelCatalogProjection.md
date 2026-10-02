# Model catalog projection UI audit

The change updates account/catalog derivation only. Existing two-column navigation, search, source scopes, selection controls, dimensions, and styling are retained. No new UI primitive or action control is introduced.

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/VariantPill.tsx:192` | Compound effort/thinking/speed trigger | keep with reason | Existing shared `Button` retains its ref, accessible name, disclosure state, and dropdown lifecycle. Custom layout accommodates the independently present brain, effort, speed, separators, and pencil within the established compact pill geometry. Only variant metadata input changes. | None. |
| `src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/keyFirstItems.tsx:88` | Account/model row labels and family counts | keep with reason | Existing Spotlight row renderer owns interaction and focus; these spans provide label/count content and introduce no independent click target. Existing compact sizes remain unchanged as requested. | None. |
| `src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/modelSelectionItems.tsx:90` | Current/recent model label and source trail | keep with reason | Existing icon, truncation, semantic text colors, and Spotlight action are retained. Catalog metadata replaces model-ID inference without changing the rendered control family. | None. |
| `src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/sourceItems.tsx:172` | Source selection row | keep with reason | Existing Spotlight action and `VariantPill` remain the only interactive controls. The fix makes source eligibility agree with model eligibility, including variant-only catalogs. | None. |
| `src/modules/MainApp/AgentOrgs/config/shared/ModelPicker.tsx:83` | Agent Org model selector | keep with reason | Continues using shared searchable `Select` with the same clear-selection option, size, callback, and disabled state; only compatible account projection is shared. | None. |
| `src/engines/ChatPanel/InputArea/components/ModelPill.tsx:250` | Session model selector | keep with reason | Existing selector pills, popover/dropdown entrypoints and visual markup are retained. Async completion now owns default/recent publication; the menu still dismisses immediately and session identity stays optimistic. | None. |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

Verification: TypeScript AST inspection of all 34 changed production TS/TSX files (including the six TSX files above) found zero raw button/form-control elements, native button creation calls, or clickable `div`/`span` substitutes. Focused behavior tests cover model/source/key-first catalog parity, independent thinking/effort/speed dimensions, and existing palette flows. Rendered ModelPill tests cover successful save, rejection/retry, direct Member ownership and late completion after navigation. No real Tauri screenshots were captured; visual parity is based on unchanged markup/classes plus rendered tests, not a live-account visual claim.
