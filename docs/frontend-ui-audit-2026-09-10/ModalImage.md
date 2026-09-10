# Modal image UI audit

| Line                                                     | Element             | Verdict          | Reason                                                                                                                                                                                                    | Suggested change |
| -------------------------------------------------------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/ModalSystem/index.tsx:76`                  | Optional image prop | keep with reason | One typed image object requires a source and explicit alt text; omitting it preserves existing modal structure.                                                                                           | None.            |
| `src/scaffold/ModalSystem/index.tsx:425`                 | Header illustration | keep with reason | Native img is appropriate inside the design-system primitive. Image precedes the existing header and footer, keeping their focus and action handling intact. Empty alt supports decorative artwork.       | None.            |
| `src/scaffold/ModalSystem/index.scss:95`                 | Image sizing        | keep with reason | Shared 3:2 aspect ratio and viewport-relative height cap avoid per-consumer layout duplication and bound the artwork on short windows. Rounded corners are inherited from the existing clipped container. | None.            |
| `src/features/Org2Cloud/SignOutConfirmationModal.tsx:18` | Logout artwork      | keep with reason | Consumer owns the bundled asset; the shared Modal has no logout-specific import. Decorative image avoids repeating the localized explanation for screen readers.                                          | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

D1–D5 reviewed. No new hardcoded colors, custom footer, or unrelated sweep candidate. Generated artwork inspected directly; desktop visual verification was not performed because computer control was not authorized.

Architecture coverage: layers 1–7 reviewed for typed optional props, production usage from both logout entry points, naming, unchanged defaults, generic shared ownership, and discoverability. Layers 8–10 are not applicable: no wire, initialization, or resolver changes. The image is a bundled static asset; no new timers, retained application state, or background work.
