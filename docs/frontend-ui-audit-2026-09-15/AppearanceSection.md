# AppearanceSection UI audit

| Line                        | Element                                    | Verdict          | Reason                                                                                                                                              | Suggested change |
| --------------------------- | ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `AppearanceSection.tsx:176` | Settings layout                            | keep with reason | Reuses the shared `SectionContainer`, `SectionRow`, and spacing tokens rather than rebuilding settings-row structure.                               | None.            |
| `AppearanceSection.tsx:184` | Appearance mode choice                     | keep with reason | Uses the shared `SegmentedTextPill`; each icon-only option has a localized accessible label and tooltip.                                            | None.            |
| `AppearanceSection.tsx:349` | App icon picker                            | keep with reason | Uses a dedicated shared `SectionContainer` and the reusable `AppIconPicker`, which provides the segmented previews, localized labels, and tooltips. | None.            |
| `AppearanceSection.tsx:233` | Boolean preferences                        | keep with reason | Uses the shared `Switch` control and preserves accessible labels where the primitive accepts them.                                                  | None.            |
| `AppearanceSection.tsx:196` | Skin, accent, font, and scale selectors    | keep with reason | These options need searchable lists, swatches, or dropdown space for their larger ranges; the shared `Select` remains the appropriate control.      | None.            |
| `AppearanceSection.tsx:382` | Icon style and Spotlight placement choices | keep with reason | Both short, mutually exclusive option sets reuse the shared 32px `SegmentedTextPill` and localized labels.                                          | None.            |
| `AppearanceSection.tsx:411` | Opacity sliders                            | keep with reason | Uses the shared `Slider` inside the standard settings-control width wrapper; no native range control or duplicated interaction is introduced.       | None.            |

Verdict totals: **0 fix**, **7 keep with reason**, **0 abstract**.
