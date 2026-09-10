# Remote account actions UI audit

| Line                                                                   | Element             | Verdict          | Reason                                                                                                         | Suggested change |
| ---------------------------------------------------------------------- | ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MobileRemote/components/modals/MobileConfirmModal.tsx:42` | Decision dialog     | keep with reason | Uses shared Modal, focus starts on Cancel, Escape calls dismissal, one-decision ref prevents duplicate confirm | None             |
| `src/modules/MobileRemote/components/modals/MobileConfirmModal.tsx:54` | Footer buttons      | keep with reason | Shared Button variants, explicit button types and translated labels                                            | None             |
| `src/modules/MobileRemote/screens/settings/SettingsTab.tsx:145`        | Account section     | keep with reason | Shared SectionContainer/SectionRow; destructive action requires confirmation                                   | None             |
| `src/modules/MobileRemote/screens/settings/SettingsTab.tsx:106`        | External navigation | keep with reason | Fixed official Cloud origin and allowlisted paths; duplicate opening is guarded; error supports retry          | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Architecture: account session comes from existing auth context; modal owns one decision, caller owns visibility and sign-out effect. Shared overlay cleanup precedes auth unmount. Manage/delete labels both open the Cloud account page and explicitly warn that browser identity may differ; no automatic account deletion occurs. No new database, credentials or timers. UI test evidence is recorded in the PR; actual light/dark phone visual check and the downstream Cloud deletion journey remain unverified.
