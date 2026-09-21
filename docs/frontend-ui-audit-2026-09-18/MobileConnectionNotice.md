# MobileConnectionNotice UI audit

| Line                            | Element                          | Verdict          | Reason                                                                                                                             | Suggested change |
| ------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `MobileConnectionNotice.tsx:61` | Failure notice                   | keep with reason | Reuses shared PageNotice with semantic text tokens and live status; no independent modal/card implementation                       | None             |
| `MobileConnectionNotice.tsx:69` | Reconnect action                 | keep with reason | Shared Button secondary/soft/small; loading and disabled behavior remain shared, mobile touch token supplies the minimum hit area  | None             |
| `MobileConnectionNotice.tsx:39` | Initial reconnect progress       | keep with reason | A plain status paragraph avoids a warning before a request has actually failed                                                     | None             |
| `mobileConnectionFeedback.ts:4` | Cause presentation across routes | keep with reason | Uses locally produced ticket/authorization categories and localized guidance; never parses or displays arbitrary server error text | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Shared notice is used in sessions and device settings; chat recovery and the terminal failure screen reuse the same cause mapping. No global Button/PageNotice configuration was changed. New production action JSX was inspected: it uses Button, with no raw button or clickable div/span bypass. The original device/settings changes in the worktree were preserved.

Real native simulator visual checks covered light and dark failure states via temporary local admission-failure injection. Both displayed the cause, automatic retry explanation, and reconnect action without clipping at iPhone 17 Pro size. Injection was removed and the system appearance restored to light. Successful connection hides the notice. Narrower devices, enlarged accessibility text, and VoiceOver were not manually exercised.

## Isolated PR validation after rebase

See [`MobileConnectionBatch.md`](../verification-2026-09-18/MobileConnectionBatch.md) for the current branch results and remaining runtime/visual gaps. Earlier counts and simulator notes above describe the original integrated worktree.
