# Illustration preview UI audit

Scope: Develop Mode tabs, illustration gallery, and local theme override on the
shared Illustration component. D1–D5 reviewed.

| Line                                                               | Element                       | Verdict          | Reason                                                                                                                                                                                       | Suggested change |
| ------------------------------------------------------------------ | ----------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MainApp/Settings/config.ts:61`                        | Header tabs                   | keep with reason | Uses SECTION_TAB_META and URL tab registration, matching other settings headers. DevelopmentSection renders only the selected body; the nested switch is removed.                            | None.            |
| `src/modules/MainApp/Settings/sections/IllustrationPreview.scss:4` | Fixed light/dark swatches     | keep with reason | Explicit reference backgrounds are the requested comparison surface. Inheriting the app theme would make both samples identical. Caption colors are paired with their reference backgrounds. | None.            |
| `src/modules/MainApp/Settings/sections/IllustrationPreview.tsx:38` | Filename labels and figures   | keep with reason | Developer-facing asset filenames identify the exact image. Localized captions name each theme; decorative images retain empty alt text. Responsive columns stack in narrow views.            | None.            |
| `src/components/Illustration/index.scss:9`                         | Explicit local theme override | keep with reason | The same production renderer supports previews without mutating the global theme. The light override excludes the dark ancestor rule; both variants are covered by computed-style tests.     | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

The gallery is bounded to ten assets / twenty image elements, uses native lazy
loading, and unmounts when returning to Controls. No timers, subscriptions, or
application caches were introduced. Source/diff inspection found no new raw
buttons, native button creation, or substitute clickable elements. Existing
controls use the shared primitives. In-app visual verification was not performed
because computer control was not requested.
