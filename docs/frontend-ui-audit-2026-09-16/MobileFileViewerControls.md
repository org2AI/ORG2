# MobileFileViewerControls UI audit

| Line                                                                              | Element                         | Verdict          | Reason                                                                                                                                                                          | Suggested change |
| --------------------------------------------------------------------------------- | ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MobileRemote/components/transcript/MobileFileViewerControls.tsx:98`  | Incomplete-content status badge | keep with reason | This is non-interactive status text using existing warning and typography tokens; an action-oriented component would add the wrong semantics and geometry.                      | None.            |
| `src/modules/MobileRemote/components/transcript/MobileFileViewerControls.tsx:106` | File preview action toolbar     | keep with reason | The toolbar supplies an accessible group name, while both actions use the shared `Button` component with visible labels, pressed/loading state, and 44 px mobile touch targets. | None.            |
| `src/modules/MobileRemote/components/transcript/MobileFileViewerControls.tsx:116` | Mobile action sizing            | keep with reason | `min-h-11` intentionally raises the shared small button from its compact desktop height to the established 44 px mobile touch target without replacing the shared presentation. | None.            |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.
