# TurnMetadataFooter UI audit

| Line                                                                            | Element                                | Verdict          | Reason                                                                                                                                                                                              | Suggested change |
| ------------------------------------------------------------------------------- | -------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/ChatHistory/components/TurnMetadataFooter/index.tsx:292` | Read/write tabs                        | keep with reason | Reuses TabPill with the browser dev tools' simple variant and no active dot; keeps chat typography and counts, with a fixed 28px height and centered line boxes                                     | None             |
| `src/engines/ChatPanel/ChatHistory/components/TurnMetadataFooter/index.tsx:263` | Container disclosure                   | keep with reason | Reuses Button with a directional chevron, localized accessible label, expanded state, and body association; keyboard activation comes from the native button; its 16px column aligns with row icons | None             |
| `src/engines/ChatPanel/ChatHistory/components/TurnMetadataFooter/index.tsx:321` | Bounded list and existing row controls | keep with reason | Preserves the existing chat/composer tokens, 320px list cap, and show-more behavior; body unmounts while collapsed; overflow scrollbar stays visible using the shared thumb color                   | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Scope: changed footer UI; reviewed design-system use, theme tokens, sizes, accessibility, and duplication. No cross-file sweep proposed. Desktop visual verification was not run because computer control was not requested.
