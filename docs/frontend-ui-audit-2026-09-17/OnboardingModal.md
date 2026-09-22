# OnboardingModal UI audit

| Line                                             | Element            | Verdict          | Reason                                                                                                                                           | Suggested change |
| ------------------------------------------------ | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/features/Onboarding/OnboardingModal.tsx:29` | Dialog shell       | keep with reason | Reuses the shared `Modal` primitive, including its image-header layout, focus trap, close action, and responsive bounds.                         | None.            |
| `src/features/Onboarding/OnboardingModal.tsx:33` | Onboarding artwork | keep with reason | Uses the shared modal `image` API and an empty alt because the image is decorative; the translated title and tutorial content carry the meaning. | None.            |
| `src/features/Onboarding/OnboardingModal.tsx:35` | 720px dialog width | keep with reason | The two-column tutorial layout needs more horizontal room than the medium preset, while `Modal` still enforces a 90vw maximum.                   | None.            |
| `src/features/Onboarding/OnboardingModal.tsx:54` | Tutorial actions   | keep with reason | Reuses the shared `ActionCard`, which renders the repository-standard `Button` and preserves keyboard behavior.                                  | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.
