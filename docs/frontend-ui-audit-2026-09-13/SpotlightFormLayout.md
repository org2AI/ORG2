# SpotlightFormLayout UI audit

| Line                                   | Element               | Verdict          | Reason                                                                                                                                            | Suggested change |
| -------------------------------------- | --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SpotlightFormLayout.tsx:7`            | Header contract       | keep with reason | A single typed header prop supplies path, back callback, loading state and trailing controls to the existing SpotlightSearchBar                   | None             |
| `SpotlightFormLayout.tsx:21`           | Layout wrapper        | keep with reason | Adds no padding or visual chrome; existing form body and footer sections retain their spacing                                                     | None             |
| `SpotlightSearchBar.tsx:155`           | Back pills            | keep with reason | Interactive paths now use native buttons so the shared back control is focusable and keyboard operable; inert paths remain noninteractive         | None             |
| `SpotlightSearchBar.tsx:199`           | Trailing actions      | keep with reason | Header-only rows align quota refresh and pagination at the right; searchable rows retain existing layout                                          | None             |
| `AddWorkingDirectoryModalShell.tsx:55` | Workspace form header | keep with reason | Uses the shared header prop; the same body is used for embedded and standalone entry points                                                       | None             |
| `SessionCreatorPalette/index.tsx:55`   | Other spotlight forms | keep with reason | Session creation, shared-session import, quota, collaboration and GitHub import all consume the same layout; obsolete SpotlightPillBar is removed | None             |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

D1–D5 reviewed. The user explicitly requested this cross-form sweep. Header-only search boilerplate now occurs only in SpotlightFormLayout. Existing standalone form headers hidden by spotlight parents are outside this sweep. No new arbitrary size/color values were added. Targeted tests cover 15 cases across seven files, including native header controls, routing of action buttons, embedded/standalone session creator behavior, quota controls and import/organization forms. Desktop screenshots, theme/viewport review and native Git execution were not run because computer control was not authorized.
