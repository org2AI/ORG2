# Onboarding modal UI audit

| Line                                                                    | Element            | Verdict          | Reason                                                                                              | Suggested change |
| ----------------------------------------------------------------------- | ------------------ | ---------------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| src/features/Onboarding/OnboardingModal.tsx:35                          | Dialog shell       | keep with reason | Uses shared Modal for focus trapping, Escape, portal and constrained width                          | None             |
| src/features/Onboarding/OnboardingModal.tsx:59                          | Discovery actions  | keep with reason | Shared ActionCard supplies native button behavior and theme tokens                                  | None             |
| src/features/Onboarding/OnboardingModal.tsx:48                          | Card groups        | keep with reason | Named sections and responsive grid distinguish getting started from new features                    | None             |
| src/scaffold/NavigationSidebar/blocks/SidebarSettingsMenuButton.tsx:474 | Account menu entry | keep with reason | Uses existing dropdown row and icon tokens; dev-mode-only entry closes menu before launching dialog | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Verification: jsdom exercises all card destinations, tour events, Escape/reopen and account-menu dispatch. No desktop visual verification; computer control was not authorized.

Follow-up verification: the account menu hides the entry outside dev mode. The host ignores open events outside dev mode and resets on disabling it. This adds no new visual pattern; verdict totals remain unchanged.
