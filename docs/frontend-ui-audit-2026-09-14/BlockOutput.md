# BlockOutput UI audit

| Line                                                          | Element                         | Verdict          | Reason                                                                                                                                           | Suggested change |
| ------------------------------------------------------------- | ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/engines/ChatPanel/blocks/primitives/BlockOutput.tsx:337` | Collapse action                 | keep with reason | Existing shared Button with secondary/outline/mini presentation and translated visible name; only its state owner changes                        | None             |
| `src/engines/ChatPanel/blocks/primitives/BlockOutput.tsx:358` | Load/retry action               | keep with reason | Uses the same shared Button family and native disabled prop; pending label remains visible, failure re-enables the action                        | None             |
| `src/engines/ChatPanel/blocks/primitives/BlockOutput.tsx:374` | Payload failure feedback        | keep with reason | Shared PageNotice danger/compact treatment with alert semantics, using theme tokens instead of a bespoke error shell                             | None             |
| `src/engines/ChatPanel/blocks/primitives/BlockOutput.tsx:329` | Payload action row              | keep with reason | Existing token-based border/fill/text and spacing align with the sibling preview row; two local states do not establish a three-site abstraction | None             |
| `src/engines/ChatPanel/blocks/primitives/BlockOutput.tsx:312` | Output text preformatted region | keep with reason | Native pre preserves terminal/code whitespace; it is content rather than an action/form-control substitute                                       | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Reviewed D1-D5 over the changed component and hook. Read the current shared Button props/presentation. Source inspection found only the two shared action buttons; no raw button, clickable substitute, native input or React createElement bypass was introduced. The rendered regression suite covers loading, full/collapse, error/retry and stale owner completion. Native screenshots, theme/viewport visual checks and screen-reader runs remain unverified; this report does not claim visual QA from jsdom.
