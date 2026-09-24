# MobileConnectionNotice UI audit

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `MobileConnectionNotice.tsx:63` | Transient connection card | fix | Desktop card padding and copy action overwhelm mobile recovery guidance | Use compact PageNotice, disable copy, and apply scoped mobile styling |
| `MobileConnectionNotice.tsx:72` | Retry control | keep with reason | Shared Button already provides loading and disabled feedback | Keep the existing control and callback |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**.

The provider still owns connection state and retry. This PR changes only the notice presentation and existing retry copy. No raw button or clickable substitute was added.
