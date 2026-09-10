# MobileRemoteSettingsSection relay disclosure UI audit

Scope: relay configuration disclosure and connection action only. Existing working-tree changes are outside this audit.

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `MobileRemoteSettingsSection.tsx:311` | Connection status/action | keep with reason | Reuses SectionRow and Button, existing text/spacing tokens; retry disables during its request | None |
| `MobileRemoteSettingsSection.tsx:345` | Advanced disclosure | keep with reason | Uses Button with aria-expanded and aria-controls; local state defaults collapsed on remount | None |
| `MobileRemoteSettingsSection.tsx:370` | Address and developer options | keep with reason | Reuses Input, Button and SegmentedTextPill; labeled input; custom settings persist independently of disclosure | None |
| `MobileRemoteSettingsSection.tsx:419` | Local token | keep with reason | Existing conditional password Input remains accessible under advanced settings and has an explicit accessible name | None |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

No arbitrary colors or dimensions introduced, and no new repeated pattern needing extraction. Real desktop visual verification (light/dark and narrow viewport) was not performed. Component DOM tests verify collapsed/expanded states, nested developer controls, remount, and configuration preservation.
