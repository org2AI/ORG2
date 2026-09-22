# Illustration UI audit

Scope: shared Illustration component and its seven consumers in login, logout,
onboarding, quit, and update. The user requested this illustration sweep; all
consumers reuse one theme treatment. D1–D5 reviewed against the final diff.

| Line                                           | Element                        | Verdict          | Reason                                                                                                                                                                                                  | Suggested change |
| ---------------------------------------------- | ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/Illustration/index.tsx:12`     | Native image primitive         | keep with reason | This reusable primitive owns the decorative image element, empty alternative text, and disabled dragging. Surrounding translated copy provides meaning. It adds no action controls.                     | None.            |
| `src/components/Illustration/index.scss:9`     | Brightness and contrast values | keep with reason | These are artwork-specific tonal adjustments, not UI surface colors. They retain varied skin tones and dark eyes while softening dark-mode contrast. App theme selection drives them without inversion. | None.            |
| `src/components/Illustration/index.scss:3`     | Contain fitting                | keep with reason | Complete scenes must remain visible within existing square login and viewport-capped modal frames. The selector intentionally overrides the modal's cover fitting.                                      | None.            |
| `src/features/Org2Cloud/SignInFeatures.tsx:68` | Existing dark caption gradient | keep with reason | White translated captions retain a dedicated dark scrim over artwork in either theme. Existing shared Button navigation and lifecycle behavior are unchanged.                                           | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

No production action controls or form fields were added or changed. Source and
diff inspection found no new raw-button or clickable-element bypasses. Existing
Modal, Button, ActionCard, and PanelFooter ownership is preserved. No new timers,
subscriptions, caches, or background work were introduced. Generated assets were
inspected, and all ten PNGs have alpha channels and matching 1536 × 1024 dimensions.
In-app light/dark and constrained-viewport visual verification was not performed;
computer control was not requested.
