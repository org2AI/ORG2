# UsageRangePicker UI audit

| Line                                                     | Element                    | Verdict          | Reason                                                                                            | Suggested change                                                                       |
| -------------------------------------------------------- | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/modules/shared/dataSource/UsageRangePicker.tsx:65`  | Range menu                 | keep with reason | All six choices use Dropdown options, shared width tokens and selected checks                     | None                                                                                   |
| `src/modules/shared/dataSource/UsageRangePicker.tsx:122` | Date-time fields           | fix              | Raw fields bypassed Input sizing and exposed seconds                                              | Applied: shared TimePicker, hour precision and accessible names without visible labels |
| `src/modules/shared/dataSource/UsageRangePicker.tsx:154` | Validation and actions     | keep with reason | Localized concise error, shared Buttons and common Apply translation; disabled invalid submission | None                                                                                   |
| `src/components/TimePicker/index.tsx:65`                 | Time-only field            | fix              | Independent native styling duplicated Input                                                       | Applied: Input small retains 28px height and existing minute behavior                  |
| `src/components/Input/index.scss:480`                    | Native date/time selection | keep with reason | Native pseudo-elements need CSS; primary-6 selection includes AM/PM and white foreground          | None                                                                                   |

Verdict totals: **2 fix**, **3 keep with reason**, **0 abstract**.

Custom editor uses 256px width. Default Input height is 32px. Native controls may still show :00 minutes in hour mode. Optional minute precision belongs to the shared date-time variant. No shared dropdown styling is changed.

Visual QA, light/dark screenshots and narrow viewport native calendar interaction remain unverified: desktop control was not authorized. Tests exercise the production panel with mocked API responses, not native browser layout.
