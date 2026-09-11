# Claude Desktop connections UI audit

| Line                               | Element                        | Verdict          | Reason                                                                                                                    | Suggested change |
| ---------------------------------- | ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `HarnessConnectionsSection.tsx:48` | App selector                   | keep with reason | Reuses SegmentedTextPill; overflow container accommodates narrow settings panels; target key unmounts the previous editor | None             |
| `HarnessConnectionsSection.tsx:60` | Import and add flows           | keep with reason | Reuses the existing credential import and key vault wizard                                                                | None             |
| `ConnectionCards.tsx:28`           | Responsive card group          | keep with reason | One/two-column token-based layout, named group, DS Button with pressed state and keyboard behavior                        | None             |
| `ConnectionCards.tsx:37`           | Selected and configured states | keep with reason | Primary outline marks draft selection; a separate configured label marks the applied connection                           | None             |
| `ConnectionCards.tsx:48`           | Endpoint text                  | keep with reason | Semantic text tokens and wrapping; no literal colors or fixed widths                                                      | None             |
| `HarnessConnectionEditor.tsx:132`  | Shared actions/status          | keep with reason | Existing SectionLayout, DS controls and live status remain shared with CLI details; no additional action dispatcher       | None             |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

Removed in review: `DesktopConnectionFields.tsx` and the Desktop branch of
`HarnessConnectionEditor.tsx` (four audited rows) were unreachable once Desktop
routed to `ClaudeProfileEditor`, and were deleted; see
`ClaudeProviderProfiles.md` in this folder for the profile editor audit.

Rendered DOM tests cover target selection and profile actions; native desktop screenshots and light/dark/narrow visual inspection were not performed because computer control was not authorized. The report records source consistency, not a visual pass. No cross-file design-system sweep candidates were found within this feature.
